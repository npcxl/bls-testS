use crate::models::pipeline::{NegativeTestCase, TestPipeline};
use futures::stream::{self, StreamExt};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json_path::JsonPath;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::mpsc::UnboundedSender;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseExecutionResult {
    pub case_id: String,
    pub category: String,
    pub title: String,
    pub method: String,
    pub url: String,
    pub actual_status: u16,
    pub expected_status_codes: Vec<u16>,
    pub duration_ms: u128,
    pub passed: bool,
    pub failure_reason: Option<String>,
    pub curl_reproduce: String,
    pub response_snippet: String,
    /// 用例类型：negative / positive
    #[serde(default)]
    pub case_type: String,
    /// 结论：passed / failed / blocked / error / inconclusive
    #[serde(default)]
    pub outcome: String,
    /// 实际发出的请求头（已渲染变量）
    #[serde(default)]
    pub request_headers: HashMap<String, String>,
    /// 实际发出的请求体
    #[serde(default)]
    pub request_body: Option<Value>,
    /// 完整响应体（截断到 8KB，供详情面板展示）
    #[serde(default)]
    pub response_body: String,
    /// 实际请求次数（含重试）
    #[serde(default)]
    pub attempts: u32,
}

pub struct PipelineRunner;

impl Default for PipelineRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl PipelineRunner {
    pub fn new() -> Self {
        Self
    }

    /// 每次执行创建两个独立客户端：
    /// - authed：带 Cookie Jar，承载登录态
    /// - anon：无 Cookie Jar，保证匿名用例不会继承会话（F04）
    fn build_clients() -> Result<(Client, Client), String> {
        let authed = Client::builder()
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| format!("初始化认证客户端失败: {}", e))?;
        let anon = Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| format!("初始化匿名客户端失败: {}", e))?;
        Ok((authed, anon))
    }

    /// 执行完整流水线：1. 串行执行前置步骤（如登录） -> 2. 并发执行反例测试
    ///
    /// `tx` 不为空时，每完成一个反例就实时推送结果（供前端流式展示）。
    pub async fn execute(
        &self,
        pipeline: &TestPipeline,
        tx: Option<UnboundedSender<CaseExecutionResult>>,
    ) -> Result<Vec<CaseExecutionResult>, String> {
        let (authed, anon) = Self::build_clients()?;
        let mut context_vars: HashMap<String, String> = HashMap::new();

        // 是否存在登录态：用于判定 401/403 是「被拦截」还是「用例目标」
        let auth_configured = pipeline.pre_steps.iter().any(|s| !s.extract_rules.is_empty())
            || pipeline.global_headers.keys().any(|k| {
                k.eq_ignore_ascii_case("authorization") || k.eq_ignore_ascii_case("cookie")
            });

        // 第一步：按顺序执行前置依赖步骤（例如：调用登录接口提取 Token）
        for step in &pipeline.pre_steps {
            let url = format!("{}{}", pipeline.base_url.trim_end_matches('/'), step.path);
            let method = Method::from_bytes(step.method.as_bytes()).unwrap_or(Method::POST);
            let mut req = authed.request(method, &url);

            for (k, v) in &step.headers {
                let rendered = Self::render_template(v, &context_vars);
                // 空值（如展会未配机构时的 agency-id）不发，避免服务端把空头当机构 0
                if rendered.trim().is_empty() || Self::has_unresolved_var(&rendered) {
                    continue;
                }
                req = req.header(k, rendered);
            }
            if let Some(body) = &step.body {
                let rendered_body_str = Self::render_template(&body.to_string(), &context_vars);
                let parsed_body: Value =
                    serde_json::from_str(&rendered_body_str).unwrap_or_else(|_| body.clone());
                req = req.json(&parsed_body);
            }

            let resp = req
                .send()
                .await
                .map_err(|e| format!("前置步骤 [{}] 请求失败: {}", step.description, e))?;

            let resp_json: Value = resp
                .json()
                .await
                .map_err(|e| format!("前置步骤 [{}] 响应非合法 JSON: {}", step.description, e))?;

            // 按照 JSONPath 提取动态变量；支持用 `|` 写多个候选路径，按顺序取第一个命中的
            // （如 ehs 统一响应 {"code":0,"data":{...}}，写 `$.data.token|$.token` 可兼容两种包装）
            for (var_name, json_path_str) in &step.extract_rules {
                let mut found: Option<String> = None;
                for candidate in json_path_str.split('|') {
                    let candidate = candidate.trim();
                    if candidate.is_empty() {
                        continue;
                    }
                    let path = JsonPath::parse(candidate)
                        .map_err(|e| format!("JSONPath 语法错误 {}: {}", candidate, e))?;
                    if let Some(node) = path.query(&resp_json).iter().next() {
                        found = Some(match node {
                            Value::String(s) => s.clone(),
                            // null 视为空（如展会未配机构时的 agencyId），不阻断后续步骤
                            Value::Null => String::new(),
                            other => other.to_string(),
                        });
                        break;
                    }
                }
                match found {
                    Some(value) => {
                        context_vars.insert(var_name.clone(), value);
                    }
                    None if var_name == "token" => {
                        return Err(format!(
                            "前置步骤 [{}] 未能从响应中提取到 token (路径: {})，实际响应: {}",
                            step.description, json_path_str, resp_json
                        ));
                    }
                    // 其它变量（机构、展位号等）缺失时按空值继续，由后续请求自行报错
                    None => {
                        context_vars.insert(var_name.clone(), String::new());
                    }
                }
            }
        }

        // 第二步：注入上下文变量，高并发执行所有反例测试（默认并发度 10）
        let vars_arc = Arc::new(context_vars);
        let base_url = pipeline.base_url.trim_end_matches('/').to_string();
        let global_headers = pipeline.global_headers.clone();
        let auth_ok = auth_configured;

        let results = stream::iter(pipeline.negative_cases.clone())
            .map(|case| {
                let client = (authed.clone(), anon.clone());
                let vars = Arc::clone(&vars_arc);
                let base = base_url.clone();
                let g_headers = global_headers.clone();
                let sender = tx.clone();
                async move {
                    let result = Self::run_single_case(
                        client.0,
                        client.1,
                        &base,
                        &g_headers,
                        &case,
                        &vars,
                        auth_ok,
                    )
                    .await;
                    if let Some(sender) = sender {
                        let _ = sender.send(result.clone());
                    }
                    result
                }
            })
            .buffer_unordered(10)
            .collect::<Vec<CaseExecutionResult>>()
            .await;

        Ok(results)
    }

    async fn run_single_case(
        authed: Client,
        anon: Client,
        base_url: &str,
        global_headers: &HashMap<String, String>,
        case: &NegativeTestCase,
        vars: &HashMap<String, String>,
        auth_configured: bool,
    ) -> CaseExecutionResult {
        let raw_path = if case.path.trim().is_empty() {
            "/"
        } else {
            case.path.trim()
        };
        let rendered_path = Self::render_template(raw_path, vars);
        let mut url = format!("{}{}", base_url, rendered_path);

        if !case.query_params.is_empty() {
            let mut pairs: Vec<String> = Vec::new();
            for (k, v) in &case.query_params {
                let raw = match v {
                    Value::String(s) => s.clone(),
                    Value::Null => String::new(),
                    other => other.to_string(),
                };
                let rendered = Self::render_template(&raw, vars);
                pairs.push(format!("{}={}", k, Self::encode_query_value(&rendered)));
            }
            url = format!("{}?{}", url, pairs.join("&"));
        }

        let raw_method = if case.method.trim().is_empty() {
            if case.body.is_some() {
                "POST"
            } else {
                "GET"
            }
        } else {
            case.method.trim()
        };

        // 非法 method 直接拒绝（不猜测成写请求，F16）
        let method = match Method::from_bytes(raw_method.as_bytes()) {
            Ok(m) => m,
            Err(_) => {
                return Self::build_invalid(
                    case,
                    url,
                    format!("非法 HTTP method: {}", raw_method),
                )
            }
        };

        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Self::build_invalid(
                case,
                url,
                "URL 非法（缺少 http:// 或 https://）".to_string(),
            );
        }

        // 显式认证模式：不再从预期状态码推断
        let auth_mode = case.auth_mode.to_ascii_lowercase();
        let is_auth_bypass = case.category.eq_ignore_ascii_case("AuthBypass");
        let anonymous = auth_mode == "none" || (is_auth_bypass && auth_mode != "inherit");

        let client = if anonymous { anon.clone() } else { authed.clone() };

        let mut merged_headers = global_headers.clone();
        for (k, v) in &case.headers {
            merged_headers.insert(k.clone(), v.clone());
        }

        let mut send_headers: Vec<(String, String)> = Vec::new();
        for (k, v) in &merged_headers {
            let rendered = Self::render_template(v, vars);
            if Self::has_unresolved_var(&rendered) || rendered.trim().is_empty() {
                continue;
            }
            let is_auth_header =
                k.eq_ignore_ascii_case("authorization") || k.eq_ignore_ascii_case("cookie");
            if anonymous
                && is_auth_header
                && !case.headers.keys().any(|hk| hk.eq_ignore_ascii_case(k))
            {
                continue;
            }
            send_headers.push((k.clone(), rendered));
        }
        let request_headers: HashMap<String, String> = send_headers.iter().cloned().collect();

        let rendered_body = case.body.as_ref().map(|b| {
            let s = Self::render_template(&b.to_string(), vars);
            serde_json::from_str::<Value>(&s).unwrap_or_else(|_| b.clone())
        });
        let allows_body = !matches!(method, Method::GET | Method::HEAD);
        let request_body = if allows_body { rendered_body.clone() } else { None };

        // cURL 基于「实际发送」的头与 body（F16）
        let curl_cmd =
            Self::build_curl(method.as_str(), &url, &request_headers, &request_body, vars);

        const MAX_ATTEMPTS: u32 = 3;
        let mut attempts: u32 = 0;
        let mut last_error = String::new();

        while attempts < MAX_ATTEMPTS {
            attempts += 1;
            let mut req = client.request(method.clone(), &url);
            for (k, v) in &send_headers {
                req = req.header(k, v);
            }
            if let Some(ref b) = request_body {
                req = req.json(b);
            }

            let start = Instant::now();
            match req.send().await {
                Ok(resp) => {
                    let duration_ms = start.elapsed().as_millis();
                    let status = resp.status().as_u16();
                    let body_text = match resp.text().await {
                        Ok(t) => t,
                        Err(e) => {
                            // 读取正文失败属于执行异常，不能当成 200 通过（F16）
                            return CaseExecutionResult {
                                case_id: case.case_id.clone(),
                                category: case.category.clone(),
                                title: case.title.clone(),
                                method: case.method.clone(),
                                url,
                                actual_status: status,
                                expected_status_codes: case.expected_status_codes.clone(),
                                duration_ms,
                                passed: false,
                                outcome: "error".to_string(),
                                failure_reason: Some(format!("读取响应正文失败: {}", e)),
                                curl_reproduce: curl_cmd,
                                response_snippet: String::new(),
                                case_type: case.case_type.clone(),
                                request_headers: request_headers.clone(),
                                request_body: request_body.clone(),
                                response_body: String::new(),
                                attempts,
                            };
                        }
                    };

                    if status >= 500 && attempts < MAX_ATTEMPTS {
                        last_error = format!("HTTP {}", status);
                        tokio::time::sleep(std::time::Duration::from_millis(
                            300 * attempts as u64,
                        ))
                        .await;
                        continue;
                    }

                    let snippet: String = body_text.chars().take(300).collect();
                    let full_body: String = body_text.chars().take(8000).collect();
                    let (outcome, failure_reason) =
                        crate::services::assertion::evaluate(case, status, &body_text, auth_configured);

                    return CaseExecutionResult {
                        case_id: case.case_id.clone(),
                        category: case.category.clone(),
                        title: case.title.clone(),
                        method: case.method.clone(),
                        url,
                        actual_status: status,
                        expected_status_codes: case.expected_status_codes.clone(),
                        duration_ms,
                        passed: outcome == crate::services::assertion::Outcome::Passed,
                        outcome: outcome.as_str().to_string(),
                        failure_reason,
                        curl_reproduce: curl_cmd,
                        response_snippet: snippet,
                        case_type: case.case_type.clone(),
                        request_headers: request_headers.clone(),
                        request_body: request_body.clone(),
                        response_body: full_body,
                        attempts,
                    };
                }
                Err(e) => {
                    last_error = format!("{}", e);
                    if attempts < MAX_ATTEMPTS {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            300 * attempts as u64,
                        ))
                        .await;
                        continue;
                    }
                }
            }
        }

        CaseExecutionResult {
            case_id: case.case_id.clone(),
            category: case.category.clone(),
            title: case.title.clone(),
            method: case.method.clone(),
            url,
            actual_status: 0,
            expected_status_codes: case.expected_status_codes.clone(),
            duration_ms: 0,
            passed: false,
            outcome: "error".to_string(),
            failure_reason: Some(format!(
                "网络或超时异常（共尝试 {} 次）: {}",
                attempts, last_error
            )),
            curl_reproduce: curl_cmd,
            response_snippet: String::new(),
            case_type: case.case_type.clone(),
            request_headers,
            request_body,
            response_body: String::new(),
            attempts,
        }
    }

    fn build_invalid(case: &NegativeTestCase, url: String, reason: String) -> CaseExecutionResult {
        CaseExecutionResult {
            case_id: case.case_id.clone(),
            category: case.category.clone(),
            title: case.title.clone(),
            method: case.method.clone(),
            url: url.clone(),
            actual_status: 0,
            expected_status_codes: case.expected_status_codes.clone(),
            duration_ms: 0,
            passed: false,
            outcome: "error".to_string(),
            failure_reason: Some(reason),
            curl_reproduce: format!("curl -X {} '{}'", case.method, url),
            response_snippet: String::new(),
            case_type: case.case_type.clone(),
            request_headers: HashMap::new(),
            request_body: case.body.clone(),
            response_body: String::new(),
            attempts: 0,
        }
    }

    /// 响应体是否是「业务错误」：兼容 code/errcode 非 0、success=false、resultCode 非 0
    #[allow(dead_code)]
    fn body_is_business_error(text: &str) -> bool {
        if let Ok(value) = serde_json::from_str::<Value>(text) {
            for key in ["code", "errcode"] {
                if let Some(code) = value.get(key) {
                    let bad = match code {
                        Value::Number(n) => n.as_i64().map(|v| v != 0).unwrap_or(false),
                        Value::String(s) => {
                            !(s == "0"
                                || s.eq_ignore_ascii_case("success")
                                || s.eq_ignore_ascii_case("ok"))
                        }
                        _ => false,
                    };
                    if bad {
                        return true;
                    }
                }
            }
            if let Some(ok) = value.get("success") {
                if ok.as_bool() == Some(false) {
                    return true;
                }
            }
            if let Some(rc) = value.get("resultCode").and_then(|v| v.as_str()) {
                if rc != "0" {
                    return true;
                }
            }
        }
        false
    }

    /// 是否还有未替换的 `{{var}}` 占位符
    fn has_unresolved_var(value: &str) -> bool {
        value.contains("{{") && value.contains("}}")
    }

    /// 最小化 URL 编码（保留 RFC3986 unreserved 字符，空格转 %20，其余 %XX）
    fn encode_query_value(raw: &str) -> String {
        let mut out = String::with_capacity(raw.len());
        for b in raw.as_bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    out.push(*b as char)
                }
                b' ' => out.push_str("%20"),
                _ => out.push_str(&format!("%{:02X}", b)),
            }
        }
        out
    }

    /// 将 {{var_name}} 替换为前置步骤提取到的真实动态值
    fn render_template(raw: &str, vars: &HashMap<String, String>) -> String {
        let mut result = raw.to_string();
        for (k, v) in vars {
            let placeholder = format!("{{{{{}}}}}", k);
            result = result.replace(&placeholder, v);
        }
        result
    }

    fn build_curl(
        method: &str,
        url: &str,
        headers: &HashMap<String, String>,
        body: &Option<Value>,
        vars: &HashMap<String, String>,
    ) -> String {
        let mut cmd = format!("curl -X {} '{}'", method, url);
        for (k, v) in headers {
            let rendered = Self::render_template(v, vars);
            if Self::has_unresolved_var(&rendered) {
                continue;
            }
            cmd.push_str(&format!(" -H '{}: {}'", k, rendered));
        }
        if !matches!(method, "GET" | "HEAD") {
            if let Some(b) = body {
                cmd.push_str(&format!(" -d '{}'", b.to_string().replace('\'', "'\\''")));
            }
        }
        cmd
    }
}
