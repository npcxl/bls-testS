use crate::models::pipeline::NegativeTestCase;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 用例结论（对齐任务书 4.2：不能只用一个 FAIL 概括所有异常）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    /// 满足全部断言
    Passed,
    /// 收到可判定响应，但违反目标规则
    Failed,
    /// 前置条件不满足（登录失败、鉴权拦截、缺 fixture）
    Blocked,
    /// 执行基础设施异常（DNS、超时、正文读取失败）
    Error,
    /// 现有断言不足以判定
    Inconclusive,
}

impl Outcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            Outcome::Passed => "passed",
            Outcome::Failed => "failed",
            Outcome::Blocked => "blocked",
            Outcome::Error => "error",
            Outcome::Inconclusive => "inconclusive",
        }
    }
}

/// 判定响应体语义：
/// Some(true)  = 明确的业务失败（code/errcode 非 0、success=false、resultCode 非 0）
/// Some(false) = 明确的业务成功（code/errcode == 0、success=true、resultCode == 0）
/// None        = 无法判定（非 JSON 或不含这些字段）
pub fn business_error(text: &str) -> Option<bool> {
    let value: Value = serde_json::from_str(text).ok()?;

    for key in ["code", "errcode"] {
        if let Some(code) = value.get(key) {
            return match code {
                Value::Number(n) => n.as_i64().map(|v| v != 0),
                Value::String(s) => s
                    .trim()
                    .parse::<i64>()
                    .ok()
                    .map(|v| v != 0)
                    .or_else(|| Some(!s.trim().is_empty())),
                _ => None,
            };
        }
    }

    if let Some(success) = value.get("success") {
        if let Some(b) = success.as_bool() {
            return Some(!b);
        }
    }

    if let Some(code) = value.get("resultCode") {
        if let Some(n) = code.as_i64() {
            return Some(n != 0);
        }
    }

    None
}

/// 核心判定：返回 (结论, 失败/阻断原因)
///
/// 规则（阶段 A：先保证不误判）：
/// - 5xx 不宣称“服务端崩溃”，标记 failed 并保留证据提示；
/// - 反例必须真正命中目标规则：401/403 且非鉴权类用例 → blocked，不能算“拦截成功”；
/// - 反例预期 200 时，必须同时出现业务错误码，否则视为“反例被接受”；
/// - 正例必须 2xx 且业务成功；
/// - 无法判定 → inconclusive，绝不默认通过。
pub fn evaluate(
    case: &NegativeTestCase,
    status: u16,
    body: &str,
    auth_configured: bool,
) -> (Outcome, Option<String>) {
    let is_positive = case.is_positive();
    let is_auth_case = case.category.eq_ignore_ascii_case("AuthBypass");
    let expected = &case.expected_status_codes;

    // 1. 服务端 5xx：保留证据，不自动断言“目标崩溃”
    if status >= 500 {
        return (
            Outcome::Failed,
            Some(format!(
                "观察到服务端 5xx（HTTP {}），需要定位是参数未校验还是服务端缺陷",
                status
            )),
        );
    }

    let biz = business_error(body);

    // 2. 正例：必须成功
    if is_positive {
        if (200..300).contains(&status) {
            return match biz {
                Some(false) => (Outcome::Passed, None),
                Some(true) => (
                    Outcome::Failed,
                    Some("正例被业务拒绝：业务码非 0".to_string()),
                ),
                None => (Outcome::Inconclusive, Some("正例返回 2xx，但响应体中没有可判定的成功标识".to_string())),
            };
        }
        if status == 401 || status == 403 {
            return (
                Outcome::Blocked,
                Some("正例请求被鉴权拦截：请检查登录态/权限配置".to_string()),
            );
        }
        return (
            Outcome::Failed,
            Some(format!(
                "正例未成功：预期 {:?}，实际 HTTP {}",
                expected, status
            )),
        );
    }

    // 3. 反例：鉴权拦截类单独处理
    if status == 401 || status == 403 {
        if expected.contains(&status) || is_auth_case {
            return (Outcome::Passed, None);
        }
        return (
            Outcome::Blocked,
            Some(if auth_configured {
                "被鉴权拦截（HTTP 401/403）：登录态可能失效，未触达业务规则".to_string()
            } else {
                "被鉴权拦截（HTTP 401/403）：本次未配置登录态，用例未触达业务规则".to_string()
            }),
        );
    }

    // 4. 反例：状态码命中
    let status_matched = if expected.is_empty() {
        (400..500).contains(&status)
    } else {
        expected.contains(&status)
    };

    if status_matched {
        if status == 200 {
            // HTTP 200 风格：必须出现业务错误码
            return match biz {
                Some(true) => (Outcome::Passed, None),
                Some(false) => (
                    Outcome::Failed,
                    Some("接口返回 200 且业务码为成功，反例被接受".to_string()),
                ),
                None => (
                    Outcome::Inconclusive,
                    Some("接口返回 200，但响应体没有可判定的业务码".to_string()),
                ),
            };
        }
        return (Outcome::Passed, None);
    }

    // 5. 2xx 且未命中预期：反例被接受
    if (200..300).contains(&status) {
        return (
            Outcome::Failed,
            Some(format!(
                "反例被接受：预期 {:?}，实际 HTTP {}，响应中也无业务错误码",
                expected, status
            )),
        );
    }

    // 6. 3xx / 其他：证据不足
    (
        Outcome::Inconclusive,
        Some(format!(
            "无法判定：预期 {:?}，实际 HTTP {}",
            expected, status
        )),
    )
}
