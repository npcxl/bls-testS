use axum::extract::{Path as AxumPath, State};
use axum::http::StatusCode;
use axum::Json;
use serde_json::{json, Value};

use crate::AppState;

type ApiError = (StatusCode, String);

/// GET /api/store/:key  —— 读取本地数据库里的数据（configs / tasks）
pub async fn get_kv(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
) -> Result<Json<Value>, ApiError> {
    match state.kv.get(&key) {
        Ok(Some(value)) => Ok(Json(value)),
        Ok(None) => Ok(Json(Value::Null)),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

/// PUT /api/store/:key  —— 覆盖写入（前端整份提交）
pub async fn put_kv(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    state
        .kv
        .put(&key, &body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(json!({ "ok": true, "key": key })))
}

/// GET /api/store  —— 列出所有 key（调试用）
pub async fn list_kv(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let keys = state
        .kv
        .keys()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(json!(keys)))
}
