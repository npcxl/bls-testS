use std::fs;
use std::path::{Path, PathBuf};

use crate::models::pipeline::TestPipeline;

pub mod kv;
pub use kv::KvStore;

/// 按项目维度持久化 TestPipeline。
///
/// 当前落地为「JSON 文件存储」（零外部依赖、可直接跑）：
/// 后续换成 SQLite（SQLx）时只需替换本文件的实现，接口保持不变。
pub struct PipelineStore {
    path: PathBuf,
}

impl PipelineStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
        }
    }

    /// 保存 / 覆盖当前项目的流水线
    pub fn save(&self, pipeline: &TestPipeline) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建数据目录失败 {}: {}", parent.display(), e))?;
        }
        let json = serde_json::to_string_pretty(pipeline)
            .map_err(|e| format!("序列化流水线失败: {}", e))?;
        fs::write(&self.path, json)
            .map_err(|e| format!("写入流水线失败 {}: {}", self.path.display(), e))
    }

    /// 启动时读取上次的流水线（没有或损坏则返回 None）
    pub fn load(&self) -> Option<TestPipeline> {
        let text = fs::read_to_string(&self.path).ok()?;
        serde_json::from_str::<TestPipeline>(&text).ok()
    }
}
