# bls-testS

**对话式自动化反例测试工具**（Rust + React + DeepSeek）。

输入目标项目 `Base URL` + PRD 需求文档 → DeepSeek 解析出接口与业务规则 → 自动生成反例变异矩阵并并发执行 → 用户在对话框里追加自然语言指令（如"这些接口需要先登录"）→ 动态改写测试流水线（挂载前置登录/变量提取）→ 重跑并实时产出 Markdown 报告。

> 完整需求与技术方案见 [`rust_react_deepseek_autotest_plan.md`](./rust_react_deepseek_autotest_plan.md)。

---

## 技术栈

| 层次 | 选型 |
| :--- | :--- |
| 前端交互 | React 18 + TypeScript + Vite + Shadcn UI（Tailwind CSS）+ Zustand + `react-markdown` |
| 后端服务 | Rust + Axum 0.7 + Tokio + SSE（Server-Sent Events） |
| AI 编排 | DeepSeek API（`deepseek-chat` / `deepseek-reasoner`）+ Tool Calling |
| 执行与存储 | Reqwest（连接池 + Cookie Jar）+ `serde_json_path` + Tera 模板 + SQLite（SQLx） |

## 目录结构

```
bls-testS/
├─ rust_react_deepseek_autotest_plan.md   # 需求文档（架构/数据模型/Prompt 协议/实现片段）
├─ backend/                               # Rust 引擎（crate: deepseek-autotest-engine）
│  ├─ src/
│  │  ├─ main.rs                          # Axum 启动、路由与 SSE
│  │  ├─ models/                          # 数据结构
│  │  │  └─ pipeline.rs                   #   TestPipeline / NegativeTestCase / 前置步骤
│  │  ├─ services/
│  │  │  ├─ deepseek.rs                   #   DeepSeek 客户端、Tool Calling、流水线变更
│  │  │  ├─ runner.rs                     #   拓扑执行前置脚本 + 并发反例请求 + 双层断言
│  │  │  └─ reporter.rs                   #   Markdown 报告渲染
│  │  ├─ api/                             # REST 路由（/api/pipeline/*）
│  │  └─ db/                              # SQLite（SQLx）持久化
│  ├─ migrations/                         # 建表脚本
│  └─ templates/                          # Tera 报告模板
├─ frontend/                              # React 工作台
│  └─ src/
│     ├─ App.tsx                          # 三栏布局：项目/文档 · 执行流与对话 · Markdown 预览
│     ├─ components/                      # Sidebar / ChatPanel / ReportPreview ...
│     ├─ services/                        # REST + SSE 客户端
│     ├─ stores/                          # Zustand 状态（项目、流水线、对话）
│     └─ types/                           # 与后端对齐的 TS 类型
├─ config/                                # 环境变量示例（真实密钥不入库）
├─ docs/                                  # 接口说明、Prompt 记录、踩坑
└─ data/                                  # 本地运行数据（不入库）
```

## 核心接口（规划）

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | `/api/pipeline/init-and-run` | 首次：Base URL + PRD → 生成反例流水线并执行，返回 Markdown 报告 |
| POST | `/api/pipeline/chat-refine-and-run` | 追问：自然语言指令 → 修改流水线 → 重跑 → 返回新报告 |
| GET | `/api/pipeline/:id/events` | SSE：推送 DeepSeek 思考过程与执行进度（规划） |
| GET | `/api/pipeline/:id/report` | 拉取最新 Markdown 报告（规划） |

默认后端端口 `8080`，前端开发端口由 Vite 分配。

## 本地启动（待补依赖）

```bash
# 后端（待补 Cargo.toml 后）
cd backend && cargo run

# 前端（待补 package.json 后）
cd frontend && npm install && npm run dev
```

**DeepSeek 配置在页面里填**：左栏「DeepSeek 配置」输入 API Key / 模型（`deepseek-chat` / `deepseek-reasoner`）/ Base URL，保存在浏览器 localStorage，随每次请求带给后端。后端环境变量只作兜底（不填也能跑，前提是 env 有 Key）。

环境变量（见 `config/.env.example`，全部可选）：

```
DEEPSEEK_API_KEY=            # 兜底 Key；前端填了就用前端的
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DATA_FILE=data/pipeline.json # 流水线持久化位置
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8080
```

## 状态

已实现（可直接 `cargo run` + `npm run dev`）：

- [x] `backend/Cargo.toml`、`frontend/package.json`
- [x] 数据模型 `TestPipeline` / `PreRequestStep` / `TestRequirement` / `NegativeTestCase`
- [x] DeepSeek 客户端：JSON Mode 一次生成（接口 JSON + PRD → 流水线）、多轮追问增量改写
- [x] 反例 6 大类：必填缺失 / 类型错误 / 边界溢出 / 空值空串 / 安全注入 / 业务规则违背（+ 声明鉴权时的鉴权绕过）
- [x] 执行器：前置步骤串行（JSONPath 提取 `{{var}}`）+ 反例并发 10 + 双层断言（5xx 崩溃 / 未按预期拦截）+ cURL 复现
- [x] Markdown 报告生成、`GET /api/pipeline/report`、前端实时预览与导出
- [x] 测试完成后自动输出 `.md` 文件到 `data/reports/{项目}-{时间}.md`，并可通过 `GET /api/pipeline/report/download` 下载
- [x] SSE 阶段事件（`/api/pipeline/events`）
- [x] 流水线持久化（`data/pipeline.json`，启动自动恢复；`db::PipelineStore` 可直接替换为 SQLite/SQLx）
- [x] 前端三栏工作台（左：项目/API JSON/PRD；中：对话追问；右：Markdown 预览）

待办 / 可选项：

- [ ] 用 SQLx 落 SQLite（替换 `backend/src/db/mod.rs` 的 JSON 实现，接口不变）
- [ ] Shadcn 组件库（当前用 Tailwind 手写等效样式，视觉一致、少一层依赖）
- [ ] Tool Calling 形式的增量改写（当前为「整份 pipeline 回写」，语义等价、更省 token）
- [ ] 多项目并行会话（当前单项目单流水线）
