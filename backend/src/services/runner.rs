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
}

pub struct PipelineRunner {
    http_client: Client,
}

impl PipelineRunner {
    pub fn new() -> Self {
        // 启用 cookie_store(true)，自动兼容基于 Cookie/Session 的登录态保持
        let http_client = Client::builder()
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("初始化 HTTP 客户端失败");
        Self { http_client }
    }

    /// 执行完整流水线：1. 串行执行前置步骤（如登录） -> 2. 并发执行反例测试
    ///
    /// `tx` 不为空时，每完成一个反例就实时推送结果（供前端流式展示）。
    pub async fn execute(
        &self,
        pipeline: &TestPipeline,
        tx: Option<UnboundedSender<CaseExecutionResult>>,
    ) -> Result<Vec<CaseExecutionResult>, String> {
        let mut context_vars: HashMap<String, String> = HashMap::new();

        // 第一步：按顺序执行前置依赖步骤（例如：调用登录接口提取 Token）
        for step in &pipeline.pre_steps {
            let url = format!("{}{}", pipeline.base_url.trim_end_matches('/'), step.path);
            let method = Method::from_bytes(step.method.as_bytes()).unwrap_or(Method::POST);
            let mut req = self.http_client.request(method, &url);

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

        let results = stream::iter(pipeline.negative_cases.clone())
            .map(|case| {
                let client = self.http_client.clone();
                let vars = Arc::clone(&vars_arc);
                let base = base_url.clone();
                let g_headers = global_headers.clone();
                let sender = tx.clone();
                async move {
                    let result =
                        Self::run_single_case(client, &base, &g_headers, &case, &vars).await;
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
        client: Client,
        base_url: &str,
        global_headers: &HashMap<String, String>,
        case: &NegativeTestCase,
        vars: &HashMap<String, String>,
    ) -> CaseExecutionResult {
        let raw_path = if case.path.trim().is_empty() {
            "/"
        } else {
            case.path.trim()
        };
        let rendered_path = Self::render_template(raw_path, vars);
        let mut url = format!("{}{}", base_url, rendered_path);

        // query_params 支持动态变量；值可能是数字/数组/null，统一转成字符串再编码
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

        // 模型可能不给 method：有 body 视为 POST，否则 GET
        let raw_method = if case.method.trim().is_empty() {
            if case.body.is_some() {
                "POST"
            } else {
                "GET"
            }
        } else {
            case.method.trim()
        };
        let method = Method::from_bytes(raw_method.as_bytes()).unwrap_or(Method::POST);

        // 地址不合法时给出可读原因（否则 reqwest 只报 builder error）
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return CaseExecutionResult {
                case_id: case.case_id.clone(),
                category: case.category.clone(),
                title: case.title.clone(),
                method: case.method.clone(),
                url: url.clone(),
                actual_status: 0,
                expected_status_codes: case.expected_status_codes.clone(),
                duration_ms: 0,
                passed: false,
                failure_reason: Some(format!(
                    "URL 非法（缺少 http:// 或 https://）：{}",
                    url
                )),
                curl_reproduce: format!("curl -X {} '{}'", raw_method, url),
                response_snippet: String::new(),
            };
        }

        let mut req = client.request(method.clone(), &url);
        let mut merged_headers = global_headers.clone();
        for (k, v) in &case.headers {
            merged_headers.insert(k.clone(), v.clone());
        }

        for (k, v) in &merged_headers {
            let rendered = Self::render_template(v, vars);
            // 变量未解析（如还没配置登录前置步骤）或解析为空时不要把这个头发出去，
            // 否则会带上字面量 {{token}} / 空值干扰服务端判断
            if Self::has_unresolved_var(&rendered) || rendered.trim().is_empty() {
                continue;
            }
            req = req.header(k, rendered);
        }

        let rendered_body = case.body.as_ref().map(|b| {
            let s = Self::render_template(&b.to_string(), vars);
            serde_json::from_str::<Value>(&s).unwrap_or_else(|_| b.clone())
        });

        // GET/HEAD 不带请求体（模型常给 body: {}）
        let allows_body = !matches!(method, Method::GET | Method::HEAD);
        if allows_body {
            if let Some(ref b) = rendered_body {
                req = req.json(b);
            }
        }

        let start = Instant::now();
        let resp_result = req.send().await;
        let duration_ms = start.elapsed().as_millis();

        let curl_cmd = Self::build_curl(method.as_str(), &url, &merged_headers, &rendered_body, vars);

        match resp_result {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body_text = resp.text().await.unwrap_or_default();
                let snippet: String = body_text.chars().take(300).collect();

                // 三层断言：
                // 1. 严禁 5xx 服务端崩溃；
                // 2. 状态码命中预期；
                // 3. 兼容「HTTP 200 + 业务错误码」风格（ehs 的接口就是这种），同样算被正确拦截
                let is_server_crash = status >= 500;
                let status_matched = if case.expected_status_codes.is_empty() {
                    (400..500).contains(&status)
                } else {
                    case.expected_status_codes.contains(&status)
                };
                let business_rejected = status == 200 && Self::body_is_business_error(&body_text);
                let passed = !is_server_crash && (status_matched || business_rejected);

                let failure_reason = if is_server_crash {
                    Some(format!("严重缺陷：反例触发服务端 5xx 崩溃 (HTTP {})", status))
                } else if !status_matched && !business_rejected {
                    Some(format!(
                        "未按预期拦截：预期状态码 {:?}，实际返回 HTTP {}，响应中也无业务错误码",
                        case.expected_status_codes, status
                    ))
                } else {
                    None
                };

                CaseExecutionResult {
                    case_id: case.case_id.clone(),
                    category: case.category.clone(),
                    title: case.title.clone(),
                    method: case.method.clone(),
                    url,
                    actual_status: status,
                    expected_status_codes: case.expected_status_codes.clone(),
                    duration_ms,
                    passed,
                    failure_reason,
                    curl_reproduce: curl_cmd,
                    response_snippet: snippet,
                }
            }
            Err(e) => CaseExecutionResult {
                case_id: case.case_id.clone(),
                category: case.category.clone(),
                title: case.title.clone(),
                method: case.method.clone(),
                url,
                actual_status: 0,
                expected_status_codes: case.expected_status_codes.clone(),
                duration_ms,
                passed: false,
                failure_reason: Some(format!("网络或超时异常: {}", e)),
                curl_reproduce: curl_cmd,
                response_snippet: String::new(),
            },
        }
    }

    /// 响应体是否是「业务错误」：兼容 code/errcode 非 0、success=false、resultCode 非 0
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
