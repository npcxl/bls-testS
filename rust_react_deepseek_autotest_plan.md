# Rust + React + DeepSeek 对话式自动化反例测试工具架构与实现方案

本方案基于 **Rust (Axum + Tokio + Reqwest)** 与 **React (TypeScript + Tailwind CSS + Shadcn UI)** 构建，由 **DeepSeek API** 驱动从“产品文档解析 → 反例用例生成 → 并发接口测试 → 对话式动态追问编排（如前置登录注入）→ Markdown 报告实时渲染”的完整闭环。

## 1. 技术栈选型与架构全景

为了支持跨项目复用、内网 API 免跨域调用以及毫秒级并发发包，整体采用前后端分离（可一键封装为 Tauri 2.0 桌面端或独立 Docker 容器）的四层架构：

| 层级 | 核心技术选型 | 关键职责说明 |
| :--- | :--- | :--- |
| **前端交互层 (UI)** | React 18 + TypeScript + Vite + **Shadcn UI (Tailwind CSS)** + Zustand + `react-markdown` | 提供类 Cursor 的三栏式 IDE 工作台（左栏项目与文档配置、中栏测试执行流与对话追问框、右栏实时 Markdown 预览与导出） |
| **后端服务与并发层** | Rust + **Axum** + **Tokio** + **SSE (Server-Sent Events)** | 暴露 REST/SSE 接口，管理多项目会话上下文，向前端实时流式推送 DeepSeek 思考过程与接口测试进度 |
| **AI 大脑与编排层** | **DeepSeek API** (`deepseek-chat` / `deepseek-reasoner`) + `async-openai` (Rust SDK) | 负责将 PRD 拆解为测试需求、生成反例变异矩阵、并在用户追问时通过 **Tool Calling** 动态修改测试流水线（如挂载登录前置步骤） |
| **动态执行与存储层** | **Reqwest** (连接池 + Cookie Jar) + **serde_json_path** + **Tera** (模板引擎) + **SQLite (SQLx)** | 按拓扑顺序执行前置脚本（提取 Token/变量）与并发反例请求，执行双层断言，渲染输出 `.md` 报告并持久化项目配置 |

## 2. 核心交互与“对话式追问”状态机设计

针对**“首次输入 URL + 需求文档完成测试后，继续用自然语言说出后续测试需求（如：这些接口需要先登录再测试）”**的核心场景，系统不能只做一次性生成，而必须将测试计划设计为**可被 DeepSeek 动态增删改的有状态流水线（Stateful Test Pipeline）**。

### 2.1 状态流转机制

1. **初始轮次（冷启动生成）**
   * 用户在左侧输入目标项目 `Base URL`（或 OpenAPI 地址）并粘贴/上传 PRD 需求文档。
   * DeepSeek 解析文档，识别出接口路径、参数约束与业务规则，生成初版《测试需求文档.md》与包含多维度反例的 `TestPipeline`（此时无前置登录步骤 `pre_steps: []`）。
   * Rust 引擎并发执行所有反例。假设目标接口有鉴权拦截，所有反例均返回 `401 Unauthorized`（而非预期的 `400 Bad Request` 参数校验拦截）。

2. **追问轮次（自然语言指令介入）**
   * 用户观察到大量 `401` 结果，在底部对话框输入：*“这些接口需要先登录再测试，登录接口是 POST /api/v1/auth/login，账号 admin 密码 123456，返回的 data.token 放到 Header 的 Authorization Bearer 里。”*
   * **智能缺省追问**：如果用户仅输入*“这些接口需要先登录再测试”*而未提供登录地址或账号，DeepSeek 会先检索初版 PRD 文档中是否包含登录接口说明；若文档中未提及，DeepSeek 会在对话框中主动反问用户提供登录路径与测试凭据。
   * **流水线热更新（Pipeline Mutation）**：拿到登录信息后，DeepSeek 调用内置工具 `upsert_pre_request_hook`，向当前项目的 `TestPipeline` 注入一个 `LoginStep`（前置步骤），并配置 JSONPath 提取器 `$.data.token -> {{auth_token}}`，同时将全局请求头更新为 `Authorization: Bearer {{auth_token}}`。
   * **自动重跑与增量对比**：Rust 引擎先执行 `pre_steps` 获取实时 Token，替换所有反例中的 `{{auth_token}}` 占位符后重新并发测试，穿透 `401` 鉴权层，真实触达后端的参数校验与业务逻辑层，并实时刷新右侧的《反例测试报告.md》。

## 3. DeepSeek 介入的核心数据结构与 Prompt 协议

在 Rust 后端中，通过 `serde` 定义严格的 JSON Schema，利用 DeepSeek 的 JSON Mode 与 Tool Calling 保证输出 100% 可被程序解析执行。

### 3.1 核心流水线数据结构 (`src/models/pipeline.rs`)

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 完整的项目测试流水线状态（支持多轮对话增量修改）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestPipeline {
    pub project_name: String,
    pub base_url: String,
    /// 全局请求头（支持 {{variable}} 动态变量占位符，如 Bearer {{token}}）
    pub global_headers: HashMap<String, String>,
    /// 前置依赖步骤（如：先登录提取 Token、先创建前置测试商品提取 ID）
    pub pre_steps: Vec<PreRequestStep>,
    /// AI 拆解出的结构化测试需求点
    pub requirements: Vec<TestRequirement>,
    /// 反例测试用例集合
    pub negative_cases: Vec<NegativeTestCase>,
}

/// 前置步骤（用于解决“需要先登录再测试”等有状态依赖）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreRequestStep {
    pub step_id: String,
    pub description: String,
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Option<serde_json::Value>,
    /// 变量提取规则：Key 为变量名（如 "token"），Value 为 JSONPath（如 "$.data.access_token"）
    pub extract_rules: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestRequirement {
    pub req_id: String,
    pub module: String,
    pub title: String,
    pub business_rule: String,
    pub target_endpoint: String,
}

/// 单个反例测试用例
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NegativeTestCase {
    pub case_id: String,
    pub req_id: String,
    /// 反例分类：MissingField | InvalidType | BoundaryOverflow | SecurityInjection | BusinessLogicViolation | AuthBypass
    pub category: String,
    pub title: String,
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub query_params: HashMap<String, String>,
    pub body: Option<serde_json::Value>,
    /// 预期 HTTP 状态码列表（如 [400, 422]）
    pub expected_status_codes: Vec<u16>,
    /// 预期响应体中应包含的错误关键字或业务码描述
    pub expected_error_hint: String,
}
```

### 3.2 DeepSeek 对话式编排的 Tool Calling 定义

当用户在聊天框输入后续测试指令时，Rust 后端将以下 Tools 注册给 DeepSeek (`https://api.deepseek.com/v1/chat/completions`)：

| Tool 名称 | 触发场景举例 | 执行动作说明 |
| :--- | :--- | :--- |
| `update_pre_steps` | “这些接口需要先登录再测试”、“测试前先调用获取验证码接口” | 在 `TestPipeline.pre_steps` 中新增或修改前置请求步骤，配置 JSONPath 提取变量并注入 `global_headers` |
| `mutate_negative_cases` | “针对金额字段补充负数和超大精度小数的反例”、“把所有接口都加上越权测试” | 向 `negative_cases` 列表追加新反例，或批量修改现有反例的请求体/请求头 |
| `update_base_config` | “把测试环境地址换成预发环境 `https://staging.api.com`” | 更新项目的 `base_url` 或全局静态 Header |
| `request_clarification` | 用户只说“需要先登录”，但上下文和 PRD 中均无登录接口或账号信息 | 不触发测试执行，直接在聊天界面向用户追问缺失的登录接口路径或测试账号 |

## 4. Rust 后端核心引擎实现 (`Axum` + `Reqwest` + `DeepSeek`)

### 4.1 `Cargo.toml` 关键依赖

```toml
[package]
name = "deepseek-autotest-engine"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = { version = "0.7", features = ["macros"] }
tokio = { version = "1.38", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "cookies", "rustls-tls"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
serde_json_path = "0.7"
futures = "0.3"
tera = "1.19"
tower-http = { version = "0.5", features = ["cors"] }
uuid = { version = "1.8", features = ["v4"] }
chrono = "0.4"
```

### 4.2 DeepSeek 客户端与多轮对话更新器 (`src/services/deepseek.rs`)

```rust
use crate::models::pipeline::TestPipeline;
use reqwest::Client;
use serde_json::{json, Value};

pub struct DeepSeekService {
    client: Client,
    api_key: String,
    model: String, // 默认使用 "deepseek-chat" (DeepSeek-V3)
}

impl DeepSeekService {
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            model: "deepseek-chat".to_string(),
        }
    }

    /// 阶段 1：根据 PRD 文本和 API 地址首次生成测试需求与反例流水线
    pub async fn init_pipeline_from_prd(
        &self,
        base_url: &str,
        prd_content: &str,
    ) -> Result<TestPipeline, String> {
        let system_prompt = r#"你是一名资深 API 安全与自动化测试架构师。
请根据用户提供的【目标 API 基础地址】与【产品需求文档 (PRD)/接口定义】，完成以下工作：
1. 拆解出结构化的测试需求点（requirements）。
2. 针对每个接口构造完备的反例测试用例（negative_cases），必须覆盖：
   - 必填参数缺失 (MissingField)
   - 字段类型错误 (InvalidType，如数字传字符串、数组传对象)
   - 边界值溢出 (BoundaryOverflow，如负数、0、空字符串、超长字符)
   - 安全注入试探 (SecurityInjection，如基础 SQL 注入、XSS 标签)
   - 业务规则违背 (BusinessLogicViolation，紧密结合 PRD 中的业务限制，如余额不足、非法状态流转)
3. 严格输出符合 TestPipeline 结构的合法 JSON 对象，不要包含任何多余的 Markdown 代码块标记。"#;

        let user_prompt = format!(
            "【目标 API 基础地址】: {}\n\n【产品需求文档内容】:\n{}",
            base_url, prd_content
        );

        self.call_json_mode(system_prompt, &user_prompt).await
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
   - 在 `pre_steps` 中添加登录请求步骤。
   - 在 `extract_rules` 中编写 JSONPath（如 `{"token": "$.data.token"}`）提取响应中的凭证。
   - 在 `global_headers` 中注入动态引用（如 `{"Authorization": "Bearer {{token}}"}`）。
2. 当用户要求追加特定业务反例或修改参数时：
   - 在 `negative_cases` 中增量补充或调整对应的反例用例。
3. 请返回 JSON 格式：`{"updated_pipeline": <完整的更新后 TestPipeline>, "agent_reply": "<向用户汇报你做了哪些调整的简明说明>"}`。"#;

        let user_prompt = format!(
            "【当前流水线配置 (JSON)】:\n{}\n\n【上一轮测试执行摘要】:\n{}\n\n【用户最新追加指令】:\n{}",
            serde_json::to_string_pretty(current_pipeline).unwrap_or_default(),
            last_execution_summary,
            user_instruction
        );

        let raw_val: Value = self.call_json_mode(system_prompt, &user_prompt).await?;
        let updated: TestPipeline = serde_json::from_value(raw_val["updated_pipeline"].clone())
            .map_err(|e| format!("解析更新后的 Pipeline 失败: {}", e))?;
        let reply = raw_val["agent_reply"]
            .as_str()
            .unwrap_or("已根据您的指令更新测试流水线。")
            .to_string();

        Ok((updated, reply))
    }

    async fn call_json_mode<T: serde::de::DeserializeOwned>(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<T, String> {
        let payload = json!({
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.2
        });

        let resp = self
            .client
            .post("https://api.deepseek.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("请求 DeepSeek API 失败: {}", e))?;

        let resp_json: Value = resp.json().await.map_err(|e| e.to_string())?;
        let content = resp_json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| format!("DeepSeek 响应异常: {}", resp_json))?;

        serde_json::from_str::<T>(content)
            .map_err(|e| format!("反序列化 DeepSeek JSON 失败: {} | 原始内容: {}", e, content))
    }
}
```

### 4.3 支持前置登录与动态变量注入的执行器 (`src/services/runner.rs`)

```rust
use crate::models::pipeline::{NegativeTestCase, TestPipeline};
use futures::stream::{self, StreamExt};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_json_path::JsonPath;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

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
    pub async fn execute(&self, pipeline: &TestPipeline) -> Result<Vec<CaseExecutionResult>, String> {
        let mut context_vars: HashMap<String, String> = HashMap::new();

        // 第一步：按顺序执行前置依赖步骤（例如：调用登录接口提取 Token）
        for step in &pipeline.pre_steps {
            let url = format!("{}{}", pipeline.base_url.trim_end_matches('/'), step.path);
            let method = Method::from_bytes(step.method.as_bytes()).unwrap_or(Method::POST);
            let mut req = self.http_client.request(method, &url);

            for (k, v) in &step.headers {
                req = req.header(k, Self::render_template(v, &context_vars));
            }
            if let Some(body) = &step.body {
                let rendered_body_str = Self::render_template(&body.to_string(), &context_vars);
                let parsed_body: Value = serde_json::from_str(&rendered_body_str).unwrap_or(body.clone());
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

            // 按照 JSONPath 提取动态变量（如 $.data.token）存入 context_vars
            for (var_name, json_path_str) in &step.extract_rules {
                let path = JsonPath::parse(json_path_str)
                    .map_err(|e| format!("JSONPath 语法错误 {}: {}", json_path_str, e))?;
                if let Some(node) = path.query(&resp_json).first() {
                    let val_str = match node {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    context_vars.insert(var_name.clone(), val_str);
                } else {
                    return Err(format!(
                        "前置步骤 [{}] 未能从响应中提取到变量 {} (路径: {})，实际响应: {}",
                        step.description, var_name, json_path_str, resp_json
                    ));
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
                async move {
                    Self::run_single_case(client, &base, &g_headers, &case, &vars).await
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
        let rendered_path = Self::render_template(&case.path, vars);
        let url = format!("{}{}", base_url, rendered_path);
        let method = Method::from_bytes(case.method.as_bytes()).unwrap_or(Method::POST);

        let mut req = client.request(method.clone(), &url);
        let mut merged_headers = global_headers.clone();
        for (k, v) in &case.headers {
            merged_headers.insert(k.clone(), v.clone());
        }

        for (k, v) in &merged_headers {
            req = req.header(k, Self::render_template(v, vars));
        }

        let rendered_body = case.body.as_ref().map(|b| {
            let s = Self::render_template(&b.to_string(), vars);
            serde_json::from_str::<Value>(&s).unwrap_or_else(|_| b.clone())
        });

        if let Some(ref b) = rendered_body {
            req = req.json(b);
        }

        let start = Instant::now();
        let resp_result = req.send().await;
        let duration_ms = start.elapsed().as_millis();

        let curl_cmd = Self::build_curl(&method.as_str(), &url, &merged_headers, &rendered_body, vars);

        match resp_result {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body_text = resp.text().await.unwrap_or_default();
                let snippet: String = body_text.chars().take(300).collect();

                // 双层断言：1. 严禁 5xx 服务端崩溃；2. 状态码需命中预期反例拦截状态码
                let is_server_crash = status >= 500;
                let status_matched = case.expected_status_codes.contains(&status);
                let passed = !is_server_crash && status_matched;

                let failure_reason = if is_server_crash {
                    Some(format!("严重缺陷：反例触发服务端 5xx 崩溃 (HTTP {})", status))
                } else if !status_matched {
                    Some(format!(
                        "未按预期拦截：预期状态码 {:?}，实际返回 HTTP {}",
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
            cmd.push_str(&format!(" -H '{}: {}'", k, Self::render_template(v, vars)));
        }
        if let Some(b) = body {
            cmd.push_str(&format!(" -d '{}'", b.to_string().replace('\'', "'\\''")));
        }
        cmd
    }
}
```

### 4.4 Markdown 报告生成器 (`src/services/reporter.rs`)

```rust
use crate::models::pipeline::TestPipeline;
use crate::services::runner::CaseExecutionResult;
use chrono::Local;

pub fn generate_markdown_report(
    pipeline: &TestPipeline,
    results: &[CaseExecutionResult],
) -> String {
    let total = results.len();
    let passed = results.iter().filter(|r| r.passed).count();
    let failed = total.saturating_sub(passed);
    let pass_rate = if total > 0 {
        (passed as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    let mut md = String::new();
    md.push_str(&format!("# {} - 自动化反例测试报告\n\n", pipeline.project_name));
    md.push_str(&format!(
        "- **生成时间**: {}\n- **目标地址**: `{}`\n- **前置依赖步骤数**: {} 个\n- **总反例数**: {} | **通过**: {} | **失败/未拦截**: {} | **通过率**: {:.1}%\n\n",
        Local::now().format("%Y-%m-%d %H:%M:%S"),
        pipeline.base_url,
        pipeline.pre_steps.len(),
        total,
        passed,
        failed,
        pass_rate
    ));

    // 1. 业务测试需求矩阵
    md.push_str("## 一、产品文档拆解测试需求矩阵\n\n");
    md.push_str("| 需求 ID | 所属模块 | 需求标题 | 关联接口 | 核心业务与校验规则 |\n");
    md.push_str("| :--- | :--- | :--- | :--- | :--- |\n");
    for req in &pipeline.requirements {
        md.push_str(&format!(
            "| `{}` | {} | {} | `{}` | {} |\n",
            req.req_id, req.module, req.title, req.target_endpoint, req.business_rule
        ));
    }
    md.push_str("\n");

    // 2. 前置依赖步骤说明（如登录拿 Token）
    if !pipeline.pre_steps.is_empty() {
        md.push_str("## 二、前置依赖步骤 (Pre-Request Hooks)\n\n");
        for (idx, step) in pipeline.pre_steps.iter().enumerate() {
            md.push_str(&format!(
                "{}. **{}** (`{} {}`) → 提取变量规则: `{:?}`\n",
                idx + 1,
                step.description,
                step.method,
                step.path,
                step.extract_rules
            ));
        }
        md.push_str("\n");
    }

    // 3. 反例执行总览表
    md.push_str("## 三、反例测试用例执行结果汇总\n\n");
    md.push_str("| 用例 ID | 变异维度 | 用例名称 | 接口 | 预期状态码 | 实际状态码 | 耗时 | 结果 |\n");
    md.push_str("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n");
    for r in results {
        let badge = if r.passed { "PASS" } else { "FAIL" };
        md.push_str(&format!(
            "| `{}` | {} | {} | `{}` | `{:?}` | `{}` | {}ms | **{}** |\n",
            r.case_id,
            r.category,
            r.title,
            r.method,
            r.expected_status_codes,
            r.actual_status,
            r.duration_ms,
            badge
        ));
    }
    md.push_str("\n");

    // 4. 失败与异常反例复现详情
    let failed_cases: Vec<&CaseExecutionResult> = results.iter().filter(|r| !r.passed).collect();
    if !failed_cases.is_empty() {
        md.push_str("## 四、失败用例与一键复现详情\n\n");
        for fc in failed_cases {
            md.push_str(&format!("### [{}] {}\n\n", fc.case_id, fc.title));
            md.push_str(&format!(
                "- **失败原因**: {}\n- **实际响应片段**: `{}`\n- **一键复现 cURL**:\n\n```bash\n{}\n```\n\n",
                fc.failure_reason.as_deref().unwrap_or("未知原因"),
                fc.response_snippet,
                fc.curl_reproduce
            ));
        }
    }

    md
}
```

## 5. React + Shadcn UI 三栏式工作台前端实现 (`src/App.tsx`)

前端推荐使用 **React 18 + Tailwind CSS + Shadcn UI + Lucide Icons**，将“配置初始化”、“对话式追问修改”和“Markdown 实时预览导出”融合在一个单页工作台中：

```tsx
import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Play, Send, FileDown, ShieldAlert, CheckCircle2, KeyRound, Plus } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function AutoTestWorkbench() {
  const [projectName, setProjectName] = useState("电商订单中心 API");
  const [baseUrl, setBaseUrl] = useState("https://api.example.com");
  const [prdText, setPrdText] = useState(
    "接口：POST /api/v1/orders 创建订单\n必填字段：sku_id (string), quantity (int, 1~99), coupon_code (optional string)。\n业务规则：下单数量不可为0或负数；单笔最大99件；未登录用户禁止下单。"
  );
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "请输入目标项目的 API 基础地址与产品需求文档，点击「生成并执行反例测试」。测试完成后，您可以随时在下方用自然语言追加测试要求（例如：需要先登录再测试）。",
    },
  ]);
  const [markdownReport, setMarkdownReport] = useState<string>("# 尚无测试报告\n请先在左侧启动首次生成与测试。");
  const [loading, setLoading] = useState(false);

  // 1. 首次启动：根据 URL + PRD 生成反例并执行测试
  const handleInitAndRun = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8080/api/pipeline/init-and-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_name: projectName, base_url: baseUrl, prd_content: prdText }),
      });
      const data = await res.json();
      setMarkdownReport(data.markdown_report);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `已完成首轮需求拆解与 ${data.total_cases} 个反例测试！通过率：${data.pass_rate}%。您可以查看右侧 Markdown 报告，或继续告诉我接下来的调整要求（如补充前置登录）。`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // 2. 对话式追问：如“这些接口需要先登录再测试...”
  const handleSendFollowUp = async () => {
    if (!chatInput.trim()) return;
    const userInstruction = chatInput;
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", content: userInstruction }]);
    setLoading(true);

    try {
      const res = await fetch("http://localhost:8080/api/pipeline/chat-refine-and-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: userInstruction }),
      });
      const data = await res.json();
      setMarkdownReport(data.markdown_report);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.agent_reply },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // 3. 导出 Markdown 文档
  const handleDownloadMd = () => {
    const blob = new Blob([markdownReport], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName}-反例测试报告.md`;
    a.click();
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans">
      {/* 左栏：多项目切换与 API / PRD 输入 */}
      <div className="w-80 border-r border-slate-800 p-4 flex flex-col gap-4 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">项目与文档配置</h2>
          <button className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> 新建项目
          </button>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">项目名称</label>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">API Base URL / OpenAPI 地址</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com"
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono"
          />
        </div>

        <div className="flex-1 flex flex-col">
          <label className="text-xs text-slate-400 block mb-1">产品需求文档 (PRD / 接口说明)</label>
          <textarea
            value={prdText}
            onChange={(e) => setPrdText(e.target.value)}
            className="w-full flex-1 bg-slate-900 border border-slate-700 rounded p-3 text-xs leading-relaxed resize-none"
          />
        </div>

        <button
          onClick={handleInitAndRun}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2 rounded flex items-center justify-center gap-2 text-sm"
        >
          <Play className="w-4 h-4" />
          {loading ? "DeepSeek 解析与测试中..." : "生成需求并执行反例测试"}
        </button>
      </div>

      {/* 中栏：DeepSeek 对话式测试编排器 */}
      <div className="w-96 border-r border-slate-800 flex flex-col bg-slate-950">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <span className="text-sm font-semibold">DeepSeek 动态测试助手</span>
          <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Session Active
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`p-3 rounded-lg text-xs leading-relaxed ${
                m.role === "user"
                  ? "bg-indigo-600/20 border border-indigo-500/30 ml-6 text-indigo-100"
                  : "bg-slate-900 border border-slate-800 mr-6 text-slate-300"
              }`}
            >
              {m.content}
            </div>
          ))}
        </div>

        {/* 快捷追问指令气泡 */}
        <div className="px-4 py-2 flex flex-wrap gap-1.5 border-t border-slate-900">
          <button
            onClick={() =>
              setChatInput("这些接口需要先登录再测试，登录接口 POST /api/v1/login，账号 admin 密码 123456，提取 data.token 放入 Authorization Bearer")
            }
            className="text-[11px] bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2 py-1 rounded flex items-center gap-1 text-slate-300"
          >
            <KeyRound className="w-3 h-3 text-amber-400" /> + 先登录再测试
          </button>
          <button
            onClick={() => setChatInput("针对所有数值字段增加负数、0 和超大整型溢出的反例")}
            className="text-[11px] bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2 py-1 rounded flex items-center gap-1 text-slate-300"
          >
            <ShieldAlert className="w-3 h-3 text-rose-400" /> + 强化数值边界反例
          </button>
        </div>

        {/* 底部自然语言追问输入框 */}
        <div className="p-3 border-t border-slate-800 flex gap-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendFollowUp()}
            placeholder="说出接下来的测试需求，如：需要先登录再测试..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs"
          />
          <button
            onClick={handleSendFollowUp}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-500 px-3 py-2 rounded text-white"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 右栏：实时 Markdown 需求与测试报告预览 */}
      <div className="flex-1 flex flex-col bg-slate-900/30">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <span className="text-sm font-semibold">实时 Markdown 测试文档预览</span>
          <button
            onClick={handleDownloadMd}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs flex items-center gap-1.5 border border-slate-700"
          >
            <FileDown className="w-3.5 h-3.5" /> 导出 .MD 报告
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 prose prose-invert max-w-none text-sm">
          <ReactMarkdown>{markdownReport}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
```
