use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;
use std::sync::Mutex;

/// 极简本地 KV 存储（SQLite）：用于保存配置、任务、请求头等前端数据
pub struct KvStore {
    conn: Mutex<Connection>,
}

impl KvStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(path)
            .map_err(|e| format!("打开 SQLite 失败 {}: {}", path.display(), e))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS kv (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );",
        )
        .map_err(|e| format!("初始化 SQLite 表失败: {}", e))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn get(&self, key: &str) -> Result<Option<Value>, String> {
        let conn = self.conn.lock().map_err(|_| "SQLite 锁失败".to_string())?;
        let raw: Option<String> = conn
            .query_row("SELECT value FROM kv WHERE key = ?1", params![key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| format!("读取 {} 失败: {}", key, e))?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn put(&self, key: &str, value: &Value) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "SQLite 锁失败".to_string())?;
        let text = value.to_string();
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "INSERT INTO kv(key, value, updated_at) VALUES(?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, text, now],
        )
        .map_err(|e| format!("写入 {} 失败: {}", key, e))?;
        Ok(())
    }

    pub fn keys(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|_| "SQLite 锁失败".to_string())?;
        let mut stmt = conn
            .prepare("SELECT key FROM kv ORDER BY key")
            .map_err(|e| format!("查询 key 失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("遍历 key 失败: {}", e))?;
        let mut out = Vec::new();
        for r in rows.flatten() {
            out.push(r);
        }
        Ok(out)
    }
}
