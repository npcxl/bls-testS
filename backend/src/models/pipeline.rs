use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 完整的项目测试流水线状态（支持多轮对话增量修改）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TestPipeline {
    #[serde(default)]
    pub project_name: String,
    #[serde(default)]
    pub base_url: String,
    /// 全局请求头（支持 {{variable}} 动态变量占位符，如 Bearer {{token}}）
    #[serde(default)]
    pub global_headers: HashMap<String, String>,
    /// 前置依赖步骤（如：先登录提取 Token、先创建前置测试商品提取 ID）
    #[serde(default)]
    pub pre_steps: Vec<PreRequestStep>,
    /// AI 拆解出的结构化测试需求点
    #[serde(default)]
    pub requirements: Vec<TestRequirement>,
    /// 反例测试用例集合
    #[serde(default)]
    pub negative_cases: Vec<NegativeTestCase>,
}

/// 前置步骤（用于解决“需要先登录再测试”等有状态依赖）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreRequestStep {
    #[serde(default, alias = "id")]
    pub step_id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
    /// 变量提取规则：Key 为变量名（如 "token"），Value 为 JSONPath（如 "$.data.access_token"）
    #[serde(default, alias = "extract")]
    pub extract_rules: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestRequirement {
    /// 兼容模型常见的 `id` 写法
    #[serde(default, alias = "id")]
    pub req_id: String,
    #[serde(default)]
    pub module: String,
    /// 兼容模型常见的 `name` 写法
    #[serde(default, alias = "name")]
    pub title: String,
    /// 兼容模型常见的 `description` 写法
    #[serde(default, alias = "description")]
    pub business_rule: String,
    #[serde(default, alias = "endpoint")]
    pub target_endpoint: String,
}

/// 单个反例测试用例
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NegativeTestCase {
    /// 兼容模型常见的 `id` 写法
    #[serde(default, alias = "id")]
    pub case_id: String,
    /// 兼容模型常见的 `requirement_id` 写法
    #[serde(default, alias = "requirement_id")]
    pub req_id: String,
    /// 反例分类：MissingField | InvalidType | BoundaryOverflow | NullValue | SecurityInjection | BusinessLogicViolation | AuthBypass
    #[serde(default)]
    pub category: String,
    /// 兼容模型常见的 `name` 写法
    #[serde(default, alias = "name")]
    pub title: String,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// 查询参数：兼容模型常见的 `params` 写法；值允许是任意 JSON（数字/数组/null 都能跑）
    #[serde(default, alias = "params")]
    pub query_params: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
    /// 预期 HTTP 状态码列表（如 [400, 422]）；为空时按「4xx 即视为被拦截」判定
    #[serde(default)]
    pub expected_status_codes: Vec<u16>,
    /// 预期响应体中应包含的错误关键字或业务码描述
    #[serde(default, alias = "expected_error")]
    pub expected_error_hint: String,
}
