use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::sse::{Event, Sse};
use axum::response::IntoResponse;
use axum::Json;
use futures::stream::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use std::convert::Infallible;

use crate::models::pipeline::{NegativeTestCase, TestPipeline};
use crate::services::deepseek::DeepSeekConfig;
use crate::services::reporter::{generate_markdown_report, save_report};
use crate::services::runner::CaseExecutionResult;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct InitAndRunRequest {
    #[serde(default)]
    pub project_name: Option<String>,
    /// 真实或参考 API 地址（如 http://10.12.1.25:48997 或 https://api.example.com）
    pub base_url: String,
    /// 接口定义 JSON（OpenAPI 片段 / 自维护接口清单均可）
    #[serde(default)]
    pub api_spec: String,
    /// 产品需求文档
    #[serde(default)]
    pub prd_content: String,
    /// DeepSeek 配置（前端填写；缺失项回落后端环境变量）
    #[serde(default)]
    pub deepseek: Option<DeepSeekConfig>,
    /// 登录前置配置：首轮执行前先登录取 token，注入全局请求头
    #[serde(default)]
    pub auth: Option<AuthConfig>,
    /// 前端生成的运行 id，用于把 SSE 事件和本次请求对上
    #[serde(default)]
    pub run_id: Option<String>,
}

/// 登录前置：先调登录接口，按 JSONPath 提取 token，注入全局请求头
#[derive(Debug, Default, Deserialize)]
#[allow(dead_code)]
pub struct AuthConfig {
    /// 登录接口路径（默认 /login/syncLogin）
    #[serde(default)]
    pub login_path: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    /// 登录请求体（由前端按手机号/展位等拼好）
    #[serde(default)]
    pub body: Option<Value>,
    /// 直接注入 Cookie（如 "JSESSIONID=xxx"）：填了就跳过登录，直接带会话跑
    #[serde(default)]
    pub cookie: Option<String>,
    /// CPS27 免登 param（形如 CPS27EFORM_{CID}_{TIMEKEY}_{EQTIMEKEY}）：
    /// 传了就先走 GET /login/getBaseInfo?param=... 取展会/展位/公司，再登录
    #[serde(default)]
    pub param: Option<String>,
    /// 免登入口用的展会 id
    #[serde(default)]
    pub exhibition_id: Option<String>,
    /// 免登入口路径（默认 /login/getBaseInfo）
    #[serde(default)]
    pub entry_path: Option<String>,
    /// token 的 JSONPath（默认 $.token）
    #[serde(default)]
    pub token_json_path: Option<String>,
    /// 注入的请求头名（默认 Authorization）
    #[serde(default)]
    pub header_name: Option<String>,
    /// 请求头前缀（默认 "Bearer "）
    #[serde(default)]
    pub header_prefix: Option<String>,
    /// 额外固定头（如 agency-id / tenant-id）
    #[serde(default)]
    pub extra_headers: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
pub struct ChatRefineRequest {
    pub instruction: String,
    #[serde(default)]
    pub deepseek: Option<DeepSeekConfig>,
    #[serde(default)]
    pub run_id: Option<String>,
}

type ApiError = (StatusCode, String);

/// 每批接口数量：接口多时分批调用 DeepSeek，避免单次输出被长度截断
const BATCH_SIZE: usize = 5;

/// 首轮：接口 JSON + PRD + BaseURL → DeepSeek 生成反例流水线 → 并发执行 → 返回报告
pub async fn init_and_run(
    State(state): State<AppState>,
    Json(req): Json<InitAndRunRequest>,
) -> Result<Json<Value>, ApiError> {
    if req.base_url.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "base_url 不能为空".to_string()));
    }
    if req.api_spec.trim().is_empty() && req.prd_content.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "api_spec 与 prd_content 至少提供一个".to_string(),
        ));
    }

    let run_id = resolve_run_id(&req.run_id);
    let project_name = req
        .project_name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "未命名项目".to_string());
    // 容错：用户常只填 host:port，没有协议会导致 reqwest 报 builder error
    let (base_url, base_fixed) = normalize_base_url(req.base_url.trim());
    if base_fixed {
        emit(
            &state,
            &run_id,
            json!({
                "type": "stage",
                "stage": "base_url_fixed",
                "message": format!("Base URL 缺少协议前缀，已自动补全为 {}", base_url)
            }),
        );
    }

    let batches = split_api_spec(&req.api_spec, BATCH_SIZE);
    let total_batches = batches.len();
    emit(
        &state,
        &run_id,
        json!({
            "type": "stage",
            "stage": "ai_parsing",
            "message": if total_batches > 1 {
                format!("接口较多，分 {} 批生成反例（每批 {} 个接口）…", total_batches, BATCH_SIZE)
            } else {
                "DeepSeek 正在解析接口定义与需求文档，生成反例用例…".to_string()
            }
        }),
    );

    let ai = state.deepseek_for(&req.deepseek);
    let mut merged = TestPipeline {
        project_name: project_name.clone(),
        base_url: base_url.clone(),
        ..Default::default()
    };
    let mut last_err = String::new();

    for (idx, batch) in batches.iter().enumerate() {
        if total_batches > 1 {
            emit(
                &state,
                &run_id,
                json!({
                    "type": "stage",
                    "stage": "ai_batch",
                    "message": format!("正在生成第 {}/{} 批反例…", idx + 1, total_batches)
                }),
            );
        }
        // 把本批可用接口显式列给模型（比只给一段 JSON 更不容易编路径）
        let batch_endpoints = extract_endpoints(batch);
        let hint = if batch_endpoints.is_empty() {
            String::new()
        } else {
            let list = batch_endpoints
                .iter()
                .map(|(m, p)| format!("{} {}", m, p))
                .collect::<Vec<_>>()
                .join("\n");
            format!(
                "本次只允许使用下列接口（method/path 必须逐字一致，不得新增或改写）：\n{}\n每个接口 2~3 条反例，本批总用例不超过 10 个，宁可精简也要保证 JSON 完整。",
                list
            )
        };
        match ai
            .init_pipeline_from_prd(
                &project_name,
                &base_url,
                batch,
                &req.prd_content,
                if hint.is_empty() { None } else { Some(hint.as_str()) },
            )
            .await
        {
            Ok(part) => {
                let part_cases = part.negative_cases.clone();
                let part_count = part_cases.len();
                merge_pipeline(&mut merged, part);
                // 每批生成完立刻推给前端（流式第一段：反例清单逐批出现）
                emit(
                    &state,
                    &run_id,
                    json!({
                        "type": "cases",
                        "partial": total_batches > 1,
                        "batch": idx + 1,
                        "batches": total_batches,
                        "count": part_count,
                        "total_cases": merged.negative_cases.len(),
                        "payload": part_cases,
                    }),
                );
            }
            Err(e) => {
                last_err = e.clone();
                emit(
                    &state,
                    &run_id,
                    json!({
                        "type": "stage",
                        "stage": "batch_failed",
                        "message": format!("第 {}/{} 批生成失败：{}", idx + 1, total_batches, e)
                    }),
                );
            }
        }
    }

    // 硬校验：只保留接口定义里真实存在的 method+path，剔除模型编造的用例
    let allowed = extract_endpoints(&req.api_spec);
    if !allowed.is_empty() {
        let dropped = filter_cases_by_spec(&mut merged.negative_cases, &allowed);
        if dropped > 0 {
            emit(
                &state,
                &run_id,
                json!({
                    "type": "stage",
                    "stage": "spec_filtered",
                    "message": format!("已剔除 {} 条不在接口定义中的用例（模型编造或写错路径）", dropped)
                }),
            );
        }
    }

    if merged.negative_cases.is_empty() {
        let msg = if last_err.is_empty() {
            "未生成任何反例，请检查接口 JSON 与需求文档".to_string()
        } else {
            format!("所有批次都失败：{}", last_err)
        };
        emit(&state, &run_id, json!({"type": "error", "message": msg}));
        return Err((StatusCode::BAD_GATEWAY, msg));
    }

    apply_auth_headers(&mut merged, req.auth.as_ref(), &state, &run_id).await?;

    // 预检：base_url 必须真的打到后端（避免打到 Apache/Nginx 的错误页，白跑几十个用例）
    if let Err(e) = preflight_base_url(&merged.base_url).await {
        emit(&state, &run_id, json!({"type": "error", "message": e}));
        return Err((StatusCode::BAD_GATEWAY, e));
    }

    run_and_store(&state, run_id, merged, None).await
}

/// 把认证信息注入 pipeline 的全局请求头（Cookie 优先，否则走登录引导）
async fn apply_auth_headers(
    merged: &mut TestPipeline,
    auth: Option<&AuthConfig>,
    state: &AppState,
    run_id: &str,
) -> Result<(), ApiError> {
    // 认证：① 直接注入 Cookie（跳过登录） ② 否则按前端两次调用完成登录
    if let Some(auth) = auth {
        let injected_cookie = auth
            .cookie
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        if let Some(cookie) = injected_cookie {
            merged.global_headers.insert("Cookie".to_string(), cookie);
            if let Some(extra) = &auth.extra_headers {
                for (k, v) in extra {
                    if !k.trim().is_empty() && !v.trim().is_empty() {
                        merged.global_headers.insert(k.clone(), v.clone());
                    }
                }
            }
            emit(
                &state,
                &run_id,
                json!({
                    "type": "stage",
                    "stage": "auth_cookie",
                    "message": format!(
                        "已注入 Cookie，跳过登录；请求头={:?}",
                        merged.global_headers.keys().collect::<Vec<_>>()
                    )
                }),
            );
        } else {
            emit(
                &state,
                &run_id,
                json!({
                    "type": "stage",
                    "stage": "auth_loading",
                    "message": "正在按前端入口完成登录（getBaseInfo → syncLogin）…"
                }),
            );
        match bootstrap_auth(&merged.base_url, auth).await {
            Ok(result) => {
                let header_name = auth
                    .header_name
                    .clone()
                    .unwrap_or_else(|| "Authorization".to_string());
                let prefix = auth
                    .header_prefix
                    .clone()
                    .unwrap_or_else(|| "Bearer ".to_string());
                merged
                    .global_headers
                    .insert(header_name, format!("{}{}", prefix, result.token));
                if let Some(agency) = result.agency_id.clone() {
                    merged.global_headers.insert("agency-id".to_string(), agency);
                }
                if let Some(tenant) = result.tenant_id.clone() {
                    merged.global_headers.insert("tenant-id".to_string(), tenant);
                }
                // /home/** 真正认的是登录会话（JSESSIONID），只带 Authorization 会 401
                if let Some(cookie) = result.cookie.clone() {
                    merged.global_headers.insert("Cookie".to_string(), cookie);
                }
                let cookie_names = result
                    .cookie
                    .as_ref()
                    .map(|c| {
                        c.split(';')
                            .filter_map(|p| p.split('=').next().map(|s| s.trim().to_string()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                emit(
                    &state,
                    &run_id,
                    json!({
                        "type": "stage",
                        "stage": "auth_ok",
                        "message": format!(
                            "登录成功：机构={:?}，租户={:?}，会话 cookie={:?}，已注入请求头={:?}",
                            result.agency_id,
                            result.tenant_id,
                            cookie_names,
                            merged.global_headers.keys().collect::<Vec<_>>()
                        )
                    }),
                );
            }
            Err(e) => {
                emit(&state, &run_id, json!({"type": "error", "message": e}));
                return Err((StatusCode::BAD_GATEWAY, e));
            }
            }
        }
    }

    Ok(())
}

/// 规范化 Base URL：缺协议自动补 http://，去掉尾部斜杠
fn normalize_base_url(raw: &str) -> (String, bool) {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        (trimmed.to_string(), false)
    } else {
        (format!("http://{}", trimmed), true)
    }
}

/// 预检：请求一个已知接口，返回 HTML 说明打到了静态站点/错误页
async fn preflight_base_url(base_url: &str) -> Result<(), String> {
    let url = format!("{}/login/getBaseInfo", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("初始化预检客户端失败: {}", e))?;
    match client.get(&url).send().await {
        Ok(resp) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if text.trim_start().starts_with('<') {
                let snippet: String = text.chars().take(120).collect();
                Err(format!(
                    "Base URL 无法访问后端接口：GET {} 返回 HTTP {}，内容是 HTML（{}）。请确认地址，例如直连 http://10.12.1.25:48997，或网关 http://pixel.369zhan.com/ehs-api",
                    url,
                    status.as_u16(),
                    snippet
                ))
            } else {
                Ok(())
            }
        }
        Err(e) => Err(format!(
            "Base URL 连接失败：GET {} 错误：{}（请确认后端已启动、地址与端口正确）",
            url, e
        )),
    }
}

/// 从 API JSON 里提取「METHOD /path」白名单：
/// 支持自维护格式 `{"endpoints":[{"method","path"}]}` 与 OpenAPI 的 `{"paths":{...}}`
fn extract_endpoints(spec: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let value: Value = match serde_json::from_str(spec.trim()) {
        Ok(v) => v,
        Err(_) => return out,
    };
    if let Some(list) = value.get("endpoints").and_then(|v| v.as_array()) {
        for item in list {
            let method = item
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET")
                .to_uppercase();
            let path = item.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if !path.trim().is_empty() {
                out.push((method, normalize_path(path)));
            }
        }
        return out;
    }
    if let Some(paths) = value.get("paths").and_then(|v| v.as_object()) {
        for (path, ops) in paths {
            if let Some(ops) = ops.as_object() {
                for name in ops.keys() {
                    let method = name.to_uppercase();
                    if ["GET", "POST", "PUT", "DELETE", "PATCH"].contains(&method.as_str()) {
                        out.push((method, normalize_path(path)));
                    }
                }
            }
        }
    }
    out
}

fn normalize_path(path: &str) -> String {
    let no_query = path.trim().split('?').next().unwrap_or("").trim();
    if no_query.starts_with('/') {
        no_query.to_string()
    } else {
        format!("/{}", no_query)
    }
}

/// 只保留接口定义里真实存在的 method+path，返回剔除数量
fn filter_cases_by_spec(cases: &mut Vec<NegativeTestCase>, allowed: &[(String, String)]) -> usize {
    if allowed.is_empty() {
        return 0;
    }
    let before = cases.len();
    cases.retain(|case| {
        let method = if case.method.trim().is_empty() {
            if case.body.is_some() {
                "POST".to_string()
            } else {
                "GET".to_string()
            }
        } else {
            case.method.trim().to_uppercase()
        };
        let path = normalize_path(&case.path);
        allowed
            .iter()
            .any(|(m, p)| m == &method && p == &path)
    });
    before.saturating_sub(cases.len())
}

/// 接口较多时按 `endpoints` 数组切片，避免单次输出被截断
fn split_api_spec(api_spec: &str, batch_size: usize) -> Vec<String> {
    let value: Value = match serde_json::from_str(api_spec.trim()) {
        Ok(v) => v,
        Err(_) => return vec![api_spec.to_string()],
    };
    let endpoints = match value.get("endpoints").and_then(|v| v.as_array()) {
        Some(list) if !list.is_empty() => list.clone(),
        _ => return vec![api_spec.to_string()],
    };
    if endpoints.len() <= batch_size {
        return vec![api_spec.to_string()];
    }
    endpoints
        .chunks(batch_size)
        .map(|chunk| {
            let mut obj = value.clone();
            obj["endpoints"] = Value::Array(chunk.to_vec());
            serde_json::to_string(&obj).unwrap_or_else(|_| api_spec.to_string())
        })
        .collect()
}

/// 登录结果（供后续请求注入）
struct AuthResult {
    token: String,
    agency_id: Option<String>,
    tenant_id: Option<String>,
    /// 登录过程中服务端下发的 Cookie（JSESSIONID 等）——/home/** 实际靠会话鉴权
    cookie: Option<String>,
}

/// 从响应头收集 Set-Cookie，按 cookie 名去重后拼成 Cookie 头的值
fn collect_cookies(resp: &reqwest::Response, store: &mut Vec<(String, String)>) {
    for value in resp.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Ok(text) = value.to_str() {
            if let Some(pair) = text.split(';').next() {
                if let Some((name, val)) = pair.split_once('=') {
                    let name = name.trim().to_string();
                    if name.is_empty() {
                        continue;
                    }
                    if let Some(existing) = store.iter_mut().find(|(n, _)| n == &name) {
                        existing.1 = val.trim().to_string();
                    } else {
                        store.push((name, val.trim().to_string()));
                    }
                }
            }
        }
    }
}

/// 按「前端真实交互」完成登录，不依赖 JSONPath 模板：
///   ① GET  {base}/login/getBaseInfo?param=…&exhibitionId=…  → 取 data（basicInfo/booth/agencyId/tenantId/cps27…）
///   ② POST {base}/login/syncLogin  body = data + 前端填的字段（userPhone 等），头带 agency-id/tenant-id
///   ③ 取 data.token
async fn bootstrap_auth(base_url: &str, auth: &AuthConfig) -> Result<AuthResult, String> {
    let pick = |v: &Option<String>, default: &str| {
        v.as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| default.to_string())
    };
    let entry_path = pick(&auth.entry_path, "/login/getBaseInfo");
    let login_path = pick(&auth.login_path, "/login/syncLogin");
    let extra = auth.extra_headers.clone().unwrap_or_default();

    let client = reqwest::Client::builder()
        .cookie_store(true)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("初始化登录客户端失败: {}", e))?;

    let base = base_url.trim_end_matches('/');
    let mut data = serde_json::Map::new();
    let mut cookie_store: Vec<(String, String)> = Vec::new();

    // ① 免登入口：拿展商资料（含 agencyId/tenantId/cps27）
    if let Some(param) = auth
        .param
        .as_ref()
        .map(|s| normalize_param(s))
        .filter(|s| !s.is_empty())
    {
        let exhibition_id = auth
            .exhibition_id
            .clone()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| std::env::var("DEFAULT_EXHIBITION_ID").ok())
            .unwrap_or_default();
        if exhibition_id.is_empty() {
            return Err(
                "缺少 exhibitionId：CPS27 链接里没有我方展会 id，请在「登录前置」里填写 exhibitionId\
                 （测试环境示例：ec21dfb67eeb4669ace30802f6aa3aab，生产：2d23dcef69434999943c4f90faa54e4e）"
                    .to_string(),
            );
        }
        let url = format!(
            "{}{}?param={}&exhibitionId={}",
            base,
            entry_path,
            encode_query(&param),
            encode_query(&exhibition_id)
        );
        let mut req = client.get(&url);
        for (k, v) in &extra {
            if !k.trim().is_empty() && !v.trim().is_empty() {
                req = req.header(k, v);
            }
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("免登入口请求失败: GET {} → {}", url, e))?;
        let status = resp.status();
        collect_cookies(&resp, &mut cookie_store);
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("免登入口响应非 JSON（HTTP {}）: {}", status, e))?;
        if body.get("code").and_then(|c| c.as_i64()).unwrap_or(-1) != 0 {
            let msg = body
                .get("msg")
                .and_then(|m| m.as_str())
                .unwrap_or("未知错误");
            return Err(format!(
                "免登入口失败（GET {}）：{}；响应：{}",
                url,
                msg,
                body.to_string().chars().take(300).collect::<String>()
            ));
        }
        if let Some(obj) = body.get("data").and_then(|d| d.as_object()) {
            data = obj.clone();
        }
        data.insert("param".to_string(), json!(param));
    }

    // 合并前端填的字段：只补空位，不覆盖免登返回的真实资料
    // （手填的 exhibitionId/boothNo 可能与 param 冲突，覆盖会导致服务端匹配失败）
    if let Some(body) = auth.body.as_ref().and_then(|b| b.as_object()) {
        for (k, v) in body {
            let incoming_blank = match v {
                Value::Null => true,
                Value::String(s) => s.trim().is_empty(),
                _ => false,
            };
            if incoming_blank {
                continue;
            }
            match data.get(k) {
                None => {
                    data.insert(k.clone(), v.clone());
                }
                Some(existing) if existing.is_null() => {
                    data.insert(k.clone(), v.clone());
                }
                Some(existing) if existing.as_str().map(|s| s.trim().is_empty()).unwrap_or(false) => {
                    data.insert(k.clone(), v.clone());
                }
                _ => {}
            }
        }
    }
    let exhibition_id = auth
        .exhibition_id
        .clone()
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if !exhibition_id.is_empty() {
        data.entry("exhibitionId".to_string())
            .or_insert_with(|| json!(exhibition_id));
        data.entry("expoId".to_string())
            .or_insert_with(|| json!(exhibition_id));
    }

    let agency_id = data
        .get("agencyId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());
    let tenant_id = data
        .get("tenantId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());

    // ② 登录：机身 = 免登 data + 前端字段（与前端 silentLoginWithPhone 完全一致）
    let login_url = format!("{}{}", base, login_path);
    let mut req = client.post(&login_url).json(&Value::Object(data.clone()));
    if let Some(agency) = &agency_id {
        req = req.header("agency-id", agency);
    }
    if let Some(tenant) = &tenant_id {
        req = req.header("tenant-id", tenant);
    }
    for (k, v) in &extra {
        if !k.trim().is_empty() && !v.trim().is_empty() {
            req = req.header(k, v);
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("登录请求失败: POST {} → {}", login_url, e))?;
    let status = resp.status();
    collect_cookies(&resp, &mut cookie_store);
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("登录响应非 JSON（HTTP {}）: {}", status, e))?;
    if body.get("code").and_then(|c| c.as_i64()).unwrap_or(-1) != 0 {
        let msg = body
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("响应里没有 msg 字段（可能是服务端异常）");
        return Err(format!(
            "登录失败（POST {}，HTTP {}）：{}；机构={:?}；响应={}",
            login_url,
            status.as_u16(),
            msg,
            agency_id,
            body.to_string().chars().take(500).collect::<String>()
        ));
    }

    // ③ 取 token（兼容 data.token / 顶层 token）
    let token = body
        .get("data")
        .and_then(|d| d.get("token"))
        .and_then(|t| t.as_str())
        .or_else(|| body.get("token").and_then(|t| t.as_str()))
        .unwrap_or_default()
        .to_string();
    if token.is_empty() {
        return Err(format!(
            "登录响应里没有 token：{}",
            body.to_string().chars().take(300).collect::<String>()
        ));
    }
    let cookie = if cookie_store.is_empty() {
        None
    } else {
        Some(
            cookie_store
                .iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect::<Vec<_>>()
                .join("; "),
        )
    };

    Ok(AuthResult {
        token,
        agency_id,
        tenant_id,
        cookie,
    })
}

/// 容错解析用户粘贴的 param：
/// 支持整段 `param=CPS27...&ShowID=...`、完整 URL、或只贴值；统一取出 param 的值
fn normalize_param(raw: &str) -> String {
    let mut text = raw.trim().to_string();
    // 允许直接粘贴完整链接
    if let Some(idx) = text.find("param=") {
        text = text[idx + "param=".len()..].to_string();
    }
    text = text
        .trim_start_matches('?')
        .trim_start_matches('&')
        .to_string();
    let value = text.split('&').next().unwrap_or("").trim().to_string();
    if value.is_empty() {
        text.trim().to_string()
    } else {
        value
    }
}

/// 查询参数百分号编码（保留 unreserved 字符）
fn encode_query(raw: &str) -> String {
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

/// 合并多批结果：需求/用例 id 冲突时加后缀，避免覆盖
fn merge_pipeline(target: &mut TestPipeline, part: TestPipeline) {
    for (k, v) in part.global_headers {
        target.global_headers.entry(k).or_insert(v);
    }
    for mut req in part.requirements {
        let base_id = if req.req_id.trim().is_empty() {
            format!("REQ-{}", target.requirements.len() + 1)
        } else {
            req.req_id.clone()
        };
        let mut id = base_id.clone();
        let mut n = 1;
        while target.requirements.iter().any(|r| r.req_id == id) {
            id = format!("{}_{}", base_id, n);
            n += 1;
        }
        req.req_id = id;
        target.requirements.push(req);
    }
    for mut case in part.negative_cases {
        let base_id = if case.case_id.trim().is_empty() {
            format!("NC-{}", target.negative_cases.len() + 1)
        } else {
            case.case_id.clone()
        };
        let mut id = base_id.clone();
        let mut n = 1;
        while target.negative_cases.iter().any(|c| c.case_id == id) {
            id = format!("{}_{}", base_id, n);
            n += 1;
        }
        case.case_id = id;
        target.negative_cases.push(case);
    }
}

/// 追问：自然语言指令 → 更新流水线 → 重跑 → 返回报告
pub async fn chat_refine_and_run(
    State(state): State<AppState>,
    Json(req): Json<ChatRefineRequest>,
) -> Result<Json<Value>, ApiError> {
    if req.instruction.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "instruction 不能为空".to_string()));
    }

    let run_id = resolve_run_id(&req.run_id);
    let current = {
        let guard = state.pipeline.read().await;
        guard.clone()
    };
    let current = match current {
        Some(p) => p,
        None => {
            let msg = "当前没有流水线，请先执行首轮生成".to_string();
            emit(&state, &run_id, json!({"type": "error", "message": msg}));
            return Err((StatusCode::BAD_REQUEST, msg));
        }
    };

    let summary = state.last_summary.read().await.clone();
    emit(
        &state,
        &run_id,
        json!({"type": "stage", "stage": "ai_refining", "message": "DeepSeek 正在按你的指令调整测试流水线…"}),
    );

    let ai = state.deepseek_for(&req.deepseek);
    let (updated, reply) = match ai
        .refine_pipeline_by_chat(&current, &summary, req.instruction.trim())
        .await
    {
        Ok(v) => v,
        Err(e) => {
            emit(&state, &run_id, json!({"type": "error", "message": e}));
            return Err((StatusCode::BAD_GATEWAY, e));
        }
    };

    emit(
        &state,
        &run_id,
        json!({
            "type": "cases",
            "count": updated.negative_cases.len(),
            "payload": updated.negative_cases,
            "requirements": updated.requirements,
            "pre_steps": updated.pre_steps,
        }),
    );

    run_and_store(&state, run_id, updated, Some(reply)).await
}

async fn run_and_store(
    state: &AppState,
    run_id: String,
    pipeline: TestPipeline,
    agent_reply: Option<String>,
) -> Result<Json<Value>, ApiError> {
    let total_cases = pipeline.negative_cases.len();
    emit(
        state,
        &run_id,
        json!({"type": "stage", "stage": "running", "message": format!("开始执行 {} 个反例用例…", total_cases)}),
    );

    // 逐条结果通过 channel → SSE 实时推送
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<CaseExecutionResult>();
    let events = state.events.clone();
    let rid = run_id.clone();
    let forwarder = tokio::spawn(async move {
        while let Some(result) = rx.recv().await {
            emit_to(&events, &rid, json!({"type": "result", "payload": result}));
        }
    });

    let results = match state.runner.execute(&pipeline, Some(tx)).await {
        Ok(r) => r,
        Err(e) => {
            let _ = forwarder.await;
            emit(state, &run_id, json!({"type": "error", "message": e}));
            return Err((StatusCode::INTERNAL_SERVER_ERROR, e));
        }
    };
    let _ = forwarder.await;

    // 全部 404 通常是 Base URL 填错（打到了别的站点），直接给出提示
    if !results.is_empty() && results.iter().all(|r| r.actual_status == 404) {
        emit(
            state,
            &run_id,
            json!({
                "type": "stage",
                "stage": "base_url_suspect",
                "message": format!(
                    "全部用例返回 404：目标地址 {} 可能不是 ehs 后端。可用：走网关 http://pixel.369zhan.com/ehs-api，或直连 http://10.12.1.25:48997",
                    pipeline.base_url
                )
            }),
        );
    }

    let report = generate_markdown_report(&pipeline, &results);
    let total = results.len();
    let passed = results.iter().filter(|r| r.passed).count();
    let failed = total.saturating_sub(passed);
    let pass_rate = if total > 0 {
        (passed as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let summary = build_summary(&results, total, passed, failed, pass_rate);

    {
        let mut guard = state.pipeline.write().await;
        *guard = Some(pipeline.clone());
    }
    // 按项目维度落盘（重启后可恢复，供多轮追问继续修改）
    if let Err(e) = state.store.save(&pipeline) {
        eprintln!("[WARN] 流水线持久化失败: {}", e);
    }
    {
        let mut guard = state.last_report.write().await;
        *guard = report.clone();
    }
    // 落盘成 .md 文件（测试完成后可直接取用）
    let report_file = match save_report(&state.report_dir, &pipeline.project_name, &report) {
        Ok(name) => {
            let mut guard = state.last_report_file.write().await;
            *guard = name.clone();
            Some(name)
        }
        Err(e) => {
            eprintln!("[WARN] 报告写入失败: {}", e);
            None
        }
    };
    {
        let mut guard = state.last_summary.write().await;
        *guard = summary.clone();
    }

    emit(
        state,
        &run_id,
        json!({
            "type": "report",
            "markdown": report,
            "report_file": report_file,
            "report_dir": (*state.report_dir).clone(),
            "total_cases": total,
            "passed": passed,
            "failed": failed,
            "pass_rate": format!("{:.1}", pass_rate),
        }),
    );

    Ok(Json(json!({
        "run_id": run_id,
        "pipeline": pipeline,
        "results": results,
        "markdown_report": report,
        "total_cases": total,
        "passed": passed,
        "failed": failed,
        "pass_rate": format!("{:.1}", pass_rate),
        "execution_summary": summary,
        "agent_reply": agent_reply,
        "report_file": report_file,
        "report_dir": (*state.report_dir).clone(),
    })))
}

fn build_summary(
    results: &[CaseExecutionResult],
    total: usize,
    passed: usize,
    failed: usize,
    pass_rate: f64,
) -> String {
    let mut lines = vec![format!(
        "共 {} 个反例，通过 {} 个，失败/未拦截 {} 个，通过率 {:.1}%",
        total, passed, failed, pass_rate
    )];
    for r in results.iter().filter(|r| !r.passed).take(8) {
        lines.push(format!(
            "- [{}] {}：{}（实际 HTTP {})",
            r.case_id,
            r.title,
            r.failure_reason.as_deref().unwrap_or("未知原因"),
            r.actual_status
        ));
    }
    lines.join("\n")
}

/// 当前流水线（供前端刷新/调试）
pub async fn current(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let guard = state.pipeline.read().await;
    match guard.clone() {
        Some(p) => Ok(Json(json!(p))),
        None => Err((StatusCode::NOT_FOUND, "尚未生成流水线".to_string())),
    }
}

/// Markdown 报告（可直接下载）
pub async fn report(State(state): State<AppState>) -> impl IntoResponse {
    let md = state.last_report.read().await.clone();
    if md.trim().is_empty() {
        return (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "尚未生成报告".to_string(),
        );
    }
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
        md,
    )
}

/// 下载最近一次落盘的 `.md` 报告（附件形式）
pub async fn report_download(State(state): State<AppState>) -> impl IntoResponse {
    let file_name = state.last_report_file.read().await.clone();
    if file_name.is_empty() {
        return (StatusCode::NOT_FOUND, "尚未生成报告文件".to_string()).into_response();
    }
    let path = std::path::PathBuf::from((*state.report_dir).clone()).join(&file_name);
    match std::fs::read_to_string(&path) {
        Ok(md) => {
            let mut headers = axum::http::HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                "text/markdown; charset=utf-8".parse().unwrap(),
            );
            headers.insert(
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"report.md\"".parse().unwrap(),
            );
            (StatusCode::OK, headers, md).into_response()
        }
        Err(_) => (StatusCode::NOT_FOUND, "报告文件不存在".to_string()).into_response(),
    }
}

/// SSE：把 AI 解析 / 反例生成 / 逐条测试结果 / 报告实时推给前端
pub async fn events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.events.subscribe();
    let stream = futures::stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(msg) => return Some((Ok(Event::default().data(msg)), rx)),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => return None,
            }
        }
    });
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

fn resolve_run_id(value: &Option<String>) -> String {
    value
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}


/// 执行任务里已经生成好的反例（不调用 AI，不重新生成）
#[derive(Debug, Deserialize)]
pub struct ExecuteRequest {
    pub pipeline: TestPipeline,
    #[serde(default)]
    pub auth: Option<AuthConfig>,
    #[serde(default)]
    pub run_id: Option<String>,
}

pub async fn execute(
    State(state): State<AppState>,
    Json(req): Json<ExecuteRequest>,
) -> Result<Json<Value>, ApiError> {
    let run_id = resolve_run_id(&req.run_id);
    let mut merged = req.pipeline;

    if merged.negative_cases.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "任务里还没有反例，请先让 AI 生成".to_string(),
        ));
    }
    if merged.base_url.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "base_url 不能为空".to_string()));
    }

    let (base_url, fixed) = normalize_base_url(&merged.base_url);
    merged.base_url = base_url;
    if fixed {
        emit(
            &state,
            &run_id,
            json!({
                "type": "stage",
                "stage": "base_url_fixed",
                "message": format!("Base URL 缺少协议前缀，已自动补全为 {}", merged.base_url)
            }),
        );
    }

    emit(
        &state,
        &run_id,
        json!({
            "type": "stage",
            "stage": "executing_existing",
            "message": format!("复用任务里的 {} 条反例执行（不重新生成）", merged.negative_cases.len())
        }),
    );
    emit(
        &state,
        &run_id,
        json!({
            "type": "cases",
            "payload": merged.negative_cases,
            "partial": false,
            "total_cases": merged.negative_cases.len()
        }),
    );

    apply_auth_headers(&mut merged, req.auth.as_ref(), &state, &run_id).await?;

    if let Err(e) = preflight_base_url(&merged.base_url).await {
        emit(&state, &run_id, json!({"type": "error", "message": e}));
        return Err((StatusCode::BAD_GATEWAY, e));
    }

    run_and_store(&state, run_id, merged, None).await
}

/// 用自然语言追加反例（只生成新增的，不重复已有）
#[derive(Debug, Deserialize)]
pub struct AppendCasesRequest {
    pub instruction: String,
    #[serde(default)]
    pub api_spec: String,
    #[serde(default)]
    pub prd_content: String,
    #[serde(default)]
    pub existing_cases: Vec<NegativeTestCase>,
    #[serde(default)]
    pub deepseek: Option<DeepSeekConfig>,
    #[serde(default)]
    pub run_id: Option<String>,
}

pub async fn append_cases(
    State(state): State<AppState>,
    Json(req): Json<AppendCasesRequest>,
) -> Result<Json<Value>, ApiError> {
    if req.instruction.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "追加描述不能为空".to_string()));
    }
    if req.api_spec.trim().is_empty() && req.prd_content.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "api_spec 与 prd_content 至少提供一个".to_string(),
        ));
    }

    let run_id = resolve_run_id(&req.run_id);
    emit(
        &state,
        &run_id,
        json!({
            "type": "stage",
            "stage": "appending",
            "message": "正在根据描述追加反例…"
        }),
    );

    let ai = state.deepseek_for(&req.deepseek);
    let added = ai
        .append_negative_cases(
            &req.existing_cases,
            req.instruction.trim(),
            &req.api_spec,
            &req.prd_content,
        )
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e))?;

    emit(
        &state,
        &run_id,
        json!({
            "type": "stage",
            "stage": "appended",
            "message": format!("已追加 {} 条反例（共 {} 条）", added.len(), req.existing_cases.len() + added.len())
        }),
    );

    Ok(Json(json!({
        "added": added,
        "total": req.existing_cases.len() + added.len(),
    })))
}

fn emit(state: &AppState, run_id: &str, body: Value) {
    emit_to(&state.events, run_id, body);
}

fn emit_to(events: &tokio::sync::broadcast::Sender<String>, run_id: &str, body: Value) {
    let mut envelope = json!({ "run_id": run_id });
    if let (Some(target), Some(src)) = (envelope.as_object_mut(), body.as_object()) {
        for (k, v) in src {
            target.insert(k.clone(), v.clone());
        }
    }
    let _ = events.send(envelope.to_string());
}

