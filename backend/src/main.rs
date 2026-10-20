mod api;
mod db;
mod models;
mod services;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::{Json, Router};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};

use crate::db::{KvStore, PipelineStore};
use crate::models::pipeline::TestPipeline;
use crate::services::deepseek::{DeepSeekConfig, DeepSeekService};
use crate::services::runner::PipelineRunner;

/// 全局状态：DeepSeek 默认配置（env 兜底）、执行器、当前流水线与最近一次报告
#[derive(Clone)]
pub struct AppState {
    pub default_api_key: Arc<String>,
    pub default_api_base: Arc<String>,
    pub default_model: Arc<String>,
    pub runner: Arc<PipelineRunner>,
    pub store: Arc<PipelineStore>,
    /// 报告输出目录（默认 data/reports）
    pub report_dir: Arc<String>,
    pub pipeline: Arc<RwLock<Option<TestPipeline>>>,
    pub last_report: Arc<RwLock<String>>,
    /// 最近一次落盘的报告文件名（用于下载接口）
    pub last_report_file: Arc<RwLock<String>>,
    pub last_summary: Arc<RwLock<String>>,
    pub events: broadcast::Sender<String>,
    /// 本地 SQLite：保存前端配置、任务、请求头等数据
    pub kv: Arc<KvStore>,
    /// 阶段 A：单实例只允许一个运行（F03 临时限制）
    pub active_run: Arc<tokio::sync::Mutex<Option<String>>>,
}

impl AppState {
    /// 本次请求使用的 DeepSeek 客户端：优先用前端传入的配置，缺失项回落到环境变量
    pub fn deepseek_for(&self, cfg: &Option<DeepSeekConfig>) -> DeepSeekService {
        let pick = |v: &Option<String>, default: &Arc<String>| {
            v.as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| (**default).clone())
        };
        let api_key = cfg.as_ref().map(|c| pick(&c.api_key, &self.default_api_key))
            .unwrap_or_else(|| (*self.default_api_key).clone());
        let api_base = cfg.as_ref().map(|c| pick(&c.base_url, &self.default_api_base))
            .unwrap_or_else(|| (*self.default_api_base).clone());
        let model = cfg.as_ref().map(|c| pick(&c.model, &self.default_model))
            .unwrap_or_else(|| (*self.default_model).clone());
        DeepSeekService::new(api_key, api_base, model)
    }
}

#[tokio::main]
async fn main() {
    let api_key = std::env::var("DEEPSEEK_API_KEY").unwrap_or_default();
    if api_key.trim().is_empty() {
        eprintln!("[INFO] 未设置 DEEPSEEK_API_KEY：可在前端「DeepSeek 配置」里填写，此处仅作兜底");
    }
    let api_base = std::env::var("DEEPSEEK_BASE_URL")
        .unwrap_or_else(|_| "https://api.deepseek.com".to_string());
    let model =
        std::env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| "deepseek-chat".to_string());
    let host = std::env::var("BACKEND_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("BACKEND_PORT").unwrap_or_else(|_| "8080".to_string());

    let (events, _) = broadcast::channel::<String>(256);

    // 按项目维度持久化当前流水线（默认 data/pipeline.json，可用 DATA_FILE 覆盖）
    let store_path =
        std::env::var("DATA_FILE").unwrap_or_else(|_| "data/pipeline.json".to_string());
    let store = PipelineStore::new(&store_path);
    // 测试完成后生成的 .md 报告目录
    let report_dir =
        std::env::var("REPORT_DIR").unwrap_or_else(|_| "data/reports".to_string());
    let restored = store.load();
    if restored.is_some() {
        println!("已恢复上次的流水线: {}", store_path);
    }

    // 本地 SQLite（保存前端配置/任务/请求头）
    let kv_path = std::env::var("DATA_DB_PATH").unwrap_or_else(|_| "data/bls.sqlite".to_string());
    let kv = KvStore::open(std::path::Path::new(&kv_path))
        .unwrap_or_else(|e| panic!("初始化本地数据库失败: {}", e));
    println!("本地数据库: {}", kv_path);

    let state = AppState {
        default_api_key: Arc::new(api_key),
        default_api_base: Arc::new(api_base),
        default_model: Arc::new(model),
        runner: Arc::new(PipelineRunner::new()),
        store: Arc::new(store),
        report_dir: Arc::new(report_dir),
        pipeline: Arc::new(RwLock::new(restored)),
        last_report: Arc::new(RwLock::new(String::new())),
        last_report_file: Arc::new(RwLock::new(String::new())),
        last_summary: Arc::new(RwLock::new(String::new())),
        events,
        kv: Arc::new(kv),
        active_run: Arc::new(tokio::sync::Mutex::new(None)),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route(
            "/api/health",
            // 带上构建标记：用于确认当前运行的进程是不是最新代码
            get(|| async {
                Json(serde_json::json!({
                    "status": "ok",
                    "version": env!("CARGO_PKG_VERSION"),
                    "build": "2026-10-20-phaseA",
                    "features": [
                        "deepseek-frontend-config",
                        "pipeline-normalize",
                        "md-report-file",
                        "sse-events",
                        "explicit-outcome",
                        "auth-isolation",
                        "single-active-run",
                        "sqlite-store",
                        "positive-and-negative"
                    ]
                }))
            }),
        )
        .route(
            "/api/pipeline/init-and-run",
            post(api::pipeline::init_and_run),
        )
        .route(
            "/api/pipeline/chat-refine-and-run",
            post(api::pipeline::chat_refine_and_run),
        )
        .route("/api/pipeline/execute", post(api::pipeline::execute))
        .route(
            "/api/pipeline/append-cases",
            post(api::pipeline::append_cases),
        )
        .route("/api/pipeline/current", get(api::pipeline::current))
        .route("/api/pipeline/report", get(api::pipeline::report))
        .route(
            "/api/pipeline/report/download",
            get(api::pipeline::report_download),
        )
        .route("/api/pipeline/events", get(api::pipeline::events))
        // 本地数据库：配置 / 任务 / 请求头
        .route("/api/store", get(api::store::list_kv))
        .route(
            "/api/store/:key",
            get(api::store::get_kv).put(api::store::put_kv),
        )
        .layer(DefaultBodyLimit::max(20 * 1024 * 1024))
        .layer(cors)
        .with_state(state);

    let addr = format!("{}:{}", host, port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("监听 {} 失败: {}", addr, e));

    println!("deepseek-autotest-engine 已启动: http://{}", addr);
    println!("DEEPSEEK_BASE_URL={}", std::env::var("DEEPSEEK_BASE_URL").unwrap_or_else(|_| "https://api.deepseek.com".into()));

    axum::serve(listener, app).await.expect("服务启动失败");
}
