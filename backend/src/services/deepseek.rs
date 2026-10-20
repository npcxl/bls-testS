use crate::models::pipeline::TestPipeline;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

/// 前端可传入的 DeepSeek 配置（不传则用后端环境变量兜底）
#[derive(Debug, Clone, Default, Deserialize)]
pub struct DeepSeekConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

pub struct DeepSeekService {
    client: Client,
    api_key: String,
    /// 默认 https://api.deepseek.com
    api_base: String,
    /// 默认 deepseek-chat (DeepSeek-V3)
    model: String,
}

impl DeepSeekService {
    pub fn new(api_key: String, api_base: String, model: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            api_base: api_base.trim_end_matches('/').to_string(),
            model,
        }
    }

    /// 阶段 1：根据【接口定义 API JSON】+【产品需求文档】+【目标地址】首次生成测试需求与反例流水线
    pub async fn init_pipeline_from_prd(
        &self,
        project_name: &str,
        base_url: &str,
        api_spec: &str,
        prd_content: &str,
        extra_hint: Option<&str>,
    ) -> Result<TestPipeline, String> {
        let system_prompt = r#"你是一名资深 API 安全与自动化测试架构师。
请根据用户提供的【目标 API 基础地址】、【接口定义 API JSON】与【产品需求文档 (PRD)】，完成以下工作：
1. 拆解出结构化的测试需求点（requirements），每个需求点必须挂到接口定义里真实存在的接口上（target_endpoint 用 "METHOD /path" 表示）。
2. 针对每个接口构造完备的反例测试用例（negative_cases），必须覆盖以下 6 大类：
   - 必填参数缺失 (MissingField)：字段完全不传
   - 字段类型错误 (InvalidType)：如数字传字符串、数组传对象、布尔传数字
   - 边界值溢出 (BoundaryOverflow)：负数、0、超大整数、超长字符串、超出范围
   - 空值/空串 (NullValue)：传 null、""、空数组、全空格
   - 安全注入试探 (SecurityInjection)：基础 SQL 注入、XSS 标签、路径穿越
   - 业务规则违背 (BusinessLogicViolation)：紧密结合 PRD 中的业务限制（如余额不足、非法状态流转、越权）
   若接口声明了鉴权，再额外补充鉴权绕过（AuthBypass：缺失/伪造/过期 Token）用例。
3. negative_cases 的 method/path 必须来自接口定义（path 只写路径部分，不含域名），不要编造不存在的接口。
4. expected_status_codes 必须是该反例「被正确拦截」时应返回的状态码数组（如 [400]、[400,422]、[401]、[403]）。
5. 严格输出符合下面结构的合法 JSON 对象，**字段名必须完全一致**（不要自造别名），
   pre_steps 初始为空数组，不要包含任何 Markdown 代码块标记或解释性文字。

结构示例：
{
  "project_name": "项目名",
  "base_url": "https://api.example.com",
  "global_headers": { "Content-Type": "application/json" },
  "pre_steps": [],
  "requirements": [
    { "req_id": "REQ-001", "module": "登录", "title": "必填校验",
      "business_rule": "userPhone 必填，缺失应 400",
      "target_endpoint": "POST /login/syncLogin" }
  ],
  "negative_cases": [
    { "case_id": "NC-001", "req_id": "REQ-001", "category": "MissingField",
      "title": "syncLogin 缺失 userPhone",
      "method": "POST", "path": "/login/syncLogin",
      "headers": {},
      "query_params": { "exhibitionId": "EX2024" },
      "body": { "companyId": "C001", "boothNo": "B01" },
      "expected_status_codes": [400],
      "expected_error_hint": "缺少必填参数" }
  ]
}

字段约定（必须遵守）：
- 需求用 `req_id`（不是 id）、`title`（不是 name）、`business_rule`（不是 description）；
- 用例用 `case_id`（不是 id）、`req_id`（不是 requirement_id）、`title`（不是 name）；
- 查询参数一律放 `query_params`（不是 params/query/args），GET 用例用；
- 请求体放 `body`（JSON 对象），POST/PUT 用例用；
- 自定义请求头放 `headers`（对象），没有就给空对象；
- 每个用例必须给 `method`、`path`、`expected_status_codes`。

6. 规模控制（必须遵守）：negative_cases 总数不超过 **30** 个。接口较多时，优先覆盖登录、下单、支付、发票等高风险接口，
   每个接口 2~3 条反例即可，宁少勿长——输出过长会被截断导致整份 JSON 不可用。
7. 该目标系统（ehs/塑料展）的业务错误统一返回 **HTTP 200 + {"code":非0,"msg":"..."}**，而不是 4xx：
   这类接口的 expected_status_codes 请写 [200]，期望提示写进 expected_error_hint（如"缺少必填参数"）；
   只有确实存在 401/403 鉴权拦截或 404 路由拦截的接口，才写 4xx。"#;

        let spec = if api_spec.trim().is_empty() {
            "（未提供接口 JSON，请依据 PRD 推断接口）"
        } else {
            api_spec
        };

        let hint = extra_hint.unwrap_or("").trim();
        let base_prompt = format!(
            "【目标项目名称】: {}\n\n【目标 API 基础地址】: {}\n\n【接口定义 API JSON】:\n{}\n\n【产品需求文档内容】:\n{}\n\n{}",
            project_name, base_url, spec, prd_content, hint
        );
        let retry_hint = "\n\n【重要】上一次输出因过长被截断（JSON 不完整）。本次请大幅压缩：\
negative_cases 总数不超过 15 个，只挑最高风险接口的最主要反例，字段必须完整可解析。";

        let mut last_err = String::new();
        for attempt in 0..2 {
            let user_prompt = if attempt == 0 {
                base_prompt.clone()
            } else {
                format!("{}{}", base_prompt, retry_hint)
            };
            match self.call_json_value(system_prompt, &user_prompt).await {
                Ok(raw) => {
                    let mut pipeline = parse_pipeline(normalize_pipeline(raw))?;
                    // 以用户输入为准，避免模型改写项目名/基础地址
                    pipeline.project_name = project_name.to_string();
                    pipeline.base_url = base_url.trim_end_matches('/').to_string();
                    return Ok(pipeline);
                }
                Err(e) if attempt == 0 && (e.contains("截断") || e.contains("EOF")) => {
                    // 输出被截断：自动缩小规模重试一次
                    last_err = e;
                }
                Err(e) => return Err(e),
            }
        }
        Err(last_err)
    }

    /// 阶段 2：根据用户的自然语言追问（如“需要先登录再测试”）动态更新流水线
    pub async fn refine_pipeline_by_chat(
        &self,
        current_pipeline: &TestPipeline,
        last_execution_summary: &str,
        user_instruction: &str,
    ) -> Result<(TestPipeline, String), String> {
        let system_prompt = r#"你是一名动态测试编排 Agent。用户正在对已有的 API 自动化测试流水线进行追问或追加约束。
常见场景处理准则：
1. 当用户提出“需要先登录再测试”或前置依赖时：
   - 在 `pre_steps` 中添加登录请求步骤（step_id 用 login_1 之类）。
   - 在 `extract_rules` 中编写 JSONPath（如 `{"token": "$.data.token"}`）提取响应中的凭证。
   - 在 `global_headers` 中注入动态引用（如 `{"Authorization": "Bearer {{token}}"}`）。
2. 当用户要求追加特定业务反例或修改参数时：
   - 在 `negative_cases` 中增量补充或调整对应的反例用例。
3. 保留原有未被要求修改的内容，输出完整的更新后流水线，不要删减 requirements/negative_cases。
4. 字段名必须与输入保持完全一致：需求用 req_id/title/business_rule/target_endpoint，
   用例用 case_id/req_id/category/title/method/path/headers/query_params/body/expected_status_codes/expected_error_hint。
5. 请返回 JSON 格式：`{"updated_pipeline": <完整的更新后 TestPipeline>, "agent_reply": "<向用户汇报你做了哪些调整的简明说明>"}`。
   不要包含 Markdown 代码块标记。"#;

        let user_prompt = format!(
            "【当前流水线配置 (JSON)】:\n{}\n\n【上一轮测试执行摘要】:\n{}\n\n【用户最新追加指令】:\n{}",
            serde_json::to_string_pretty(current_pipeline).unwrap_or_default(),
            last_execution_summary,
            user_instruction
        );

        let raw_val = self.call_json_value(system_prompt, &user_prompt).await?;
        let updated = parse_pipeline(normalize_pipeline(raw_val["updated_pipeline"].clone()))?;
        let reply = raw_val["agent_reply"]
            .as_str()
            .unwrap_or("已根据您的指令更新测试流水线。")
            .to_string();

        Ok((updated, reply))
    }

    /// 每次请求都要求模型输出纯 JSON（JSON Mode），失败时把原始内容带回便于排查
    /// 调 DeepSeek JSON Mode，返回原始 JSON（由调用方自行归一化/反序列化）
    async fn call_json_value(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<Value, String> {
        let payload = json!({
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.2,
            "max_tokens": 8192
        });

        let resp = self
            .client
            .post(format!("{}/v1/chat/completions", self.api_base))
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("请求 DeepSeek API 失败: {}", e))?;

        let status = resp.status();
        let resp_json: Value = resp
            .json()
            .await
            .map_err(|e| format!("DeepSeek 响应非 JSON (HTTP {}): {}", status, e))?;

        if !status.is_success() {
            return Err(format!("DeepSeek 返回 HTTP {}: {}", status, resp_json));
        }

        // 输出被截断时给出明确原因（调用方会自动缩小规模重试）
        let finish_reason = resp_json["choices"][0]["finish_reason"]
            .as_str()
            .unwrap_or("");
        if finish_reason == "length" {
            return Err("DeepSeek 输出超出长度限制被截断（finish_reason=length）".to_string());
        }

        let content = resp_json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| format!("DeepSeek 响应异常: {}", resp_json))?;

        // 兜底：模型偶尔会带 ```json 代码块
        let cleaned = content
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        serde_json::from_str::<Value>(cleaned).map_err(|e| {
            let preview: String = content.chars().take(800).collect();
            format!(
                "DeepSeek 返回内容不是合法 JSON: {} | 原始内容(截断): {}",
                e, preview
            )
        })
    }
}

/// 把模型常见的“别名写法”归一化成我们的结构（幂等，可重复调用）
fn normalize_pipeline(mut value: Value) -> Value {
    if !value.is_object() {
        return value;
    }

    // 顶层别名
    rename_key(&mut value, "cases", "negative_cases");
    rename_key(&mut value, "reqs", "requirements");
    if value.get("global_headers").is_none() {
        value["global_headers"] = json!({});
    }
    if value.get("pre_steps").is_none() {
        value["pre_steps"] = json!([]);
    }
    if value.get("requirements").is_none() {
        value["requirements"] = json!([]);
    }
    if value.get("negative_cases").is_none() {
        value["negative_cases"] = json!([]);
    }

    // 前置步骤
    if let Some(steps) = value.get_mut("pre_steps").and_then(|v| v.as_array_mut()) {
        for step in steps {
            rename_key(step, "id", "step_id");
            rename_key(step, "extract", "extract_rules");
            rename_key(step, "params", "query_params");
            if step.get("headers").is_none() {
                step["headers"] = json!({});
            }
            if step.get("extract_rules").is_none() {
                step["extract_rules"] = json!({});
            }
        }
    }

    // 需求点
    if let Some(reqs) = value.get_mut("requirements").and_then(|v| v.as_array_mut()) {
        for req in reqs {
            rename_key(req, "id", "req_id");
            rename_key(req, "name", "title");
            rename_key(req, "description", "business_rule");
            rename_key(req, "endpoint", "target_endpoint");
            if req.get("module").is_none() {
                req["module"] = json!("通用");
            }
        }
    }

    // 反例用例
    if let Some(cases) = value.get_mut("negative_cases").and_then(|v| v.as_array_mut()) {
        for case in cases {
            rename_key(case, "id", "case_id");
            rename_key(case, "requirement_id", "req_id");
            rename_key(case, "name", "title");
            rename_key(case, "params", "query_params");
            rename_key(case, "expected_error", "expected_error_hint");
            if case.get("headers").is_none() {
                case["headers"] = json!({});
            }
            if case.get("query_params").is_none() {
                case["query_params"] = json!({});
            }
            if case.get("expected_status_codes").is_none() {
                case["expected_status_codes"] = json!([400]);
            }
            // 有些模型把 body 写成 JSON 字符串，转成对象
            if let Some(body) = case.get("body").cloned() {
                if let Some(text) = body.as_str() {
                    if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                        case["body"] = parsed;
                    }
                }
            }
        }
    }

    value
}

fn rename_key(value: &mut Value, from: &str, to: &str) {
    if let Some(obj) = value.as_object_mut() {
        if !obj.contains_key(to) {
            if let Some(v) = obj.remove(from) {
                obj.insert(to.to_string(), v);
            }
        }
    }
}

fn parse_pipeline(value: Value) -> Result<TestPipeline, String> {
    let preview = value.to_string();
    serde_json::from_value(value).map_err(|e| {
        let s: String = preview.chars().take(800).collect();
        format!("解析测试流水线失败: {} | 归一化后内容(截断): {}", e, s)
    })
}
