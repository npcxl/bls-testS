# bls-testS 代码审查、流程重构与部署整改任务书

> 直接交给 Codex 执行。先复核当前分支，再按阶段修改；本文件同时包含审查证据、目标流程、实现边界和验收要求。

- 仓库：https://github.com/npcxl/bls-testS
- 审查日期：2026-10-20（北京时间）
- 审查分支：`main`
- 审查提交：`60c12d68ebda6247f01826026248c31757c229b3`
- 定位：Rust + React + DeepSeek 的 API 反例测试工作台。
- 本次交付范围：代码审查与重构/部署方案。没有向仓库提交修改，没有部署远程服务，也没有访问或测试示例里的真实业务系统。

## 1. 结论与已做验证

当前主要问题在测试判定、任务身份、认证隔离与执行生命周期。继续增加 AI 提示词或调整页面，无法解决结果不可信和任务串线。

建议保留 Rust/Axum、React、DeepSeek 和现有工作台布局，逐步修复，不要整体推倒重写。第一阶段只做好“一个项目、一个确定性计划、一次可追踪执行、一个可信报告”，之后再开放多任务排队。

### 1.1 本次实际验证

| 检查 | 结果 | 能证明的范围 |
| --- | --- | --- |
| GitHub 元信息、递归目录与关键源码读取 | 完成，并固定到上述提交 | 分析基于真实代码，而非 README 的功能描述 |
| 本地拉取仓库并核对 HEAD | 与审查提交一致 | 本地审查与远端快照一致 |
| 前端 `npm ci --ignore-scripts --no-audit --no-fund` | 成功，安装 218 个包 | 锁文件依赖可安装；未运行依赖生命周期脚本 |
| 前端 `npm run build` | 成功，TypeScript 与 Vite 构建通过 | 当前前端能编译，不能据此推断流程正确 |
| “创建并执行”处理函数验证 | 确认缺陷：新增 1 个任务，状态仍为 pending，API 调用 0 次 | 使用实际 App.tsx 转译代码和模拟 React hooks 执行按钮处理函数；不是浏览器 E2E |
| Rust 编译/测试 | 未执行 | 当前环境无 cargo/rustc，不能声称后端编译通过或失败 |
| DeepSeek 实际调用、目标接口联调 | 未执行 | 没有使用真实密钥、登录凭证或业务目标环境 |
| 平台自身测试/CI 盘点 | 当前树未见自动化测试文件或 `.github/workflows` | 不存在可据以证明引擎正确性的仓库内回归门禁 |

以下问题区分为“代码可确认”与“需要联调验证的风险”。不得把审查推导包装成已在真实系统复现。

## 2. 优先级与代码问题清单

- P0：先修复的核心可信度/执行阻断问题；服务化安全项在多人或网络部署前必须解决。
- P1：完成可持续使用所需的流程与数据一致性问题。
- P2：维护、展示和部署完善项。

### F01 · P0 · HTTP 200 成功响应会被反例判为通过【代码可确认】

位置：`backend/src/services/deepseek.rs:89–93`；`backend/src/services/runner.rs:273–294`。

提示词要求业务错误使用 `expected_status_codes: [200]`，执行器判定：

```rust
let passed = !is_server_crash && (status_matched || business_rejected);
```

因此预期 `[200]` 时，实际 `200 + {"code":0,"msg":"成功"}` 也通过，甚至 HTTP 200 的 HTML 页面也可能通过。`expected_error_hint` 虽在模型中定义，执行器未使用。

另一个方向也有误判：预期缺少参数应 400，实际 HTTP 200 + 登录失效业务码，同样因 `business_rejected` 而通过。它没有验证请求是否触达被测规则。

修改要求：

1. 增加显式断言组，必须匹配状态、业务码及必要字段，而非“任意错误就通过”。
2. HTTP 状态风格与 HTTP 200 业务码风格由项目响应契约配置，移除全局猜测。
3. 参数测试遇到登录失败、路由错误、限流或网关错误，不得计为规则拦截成功。
4. 未知响应或断言不足返回 `inconclusive`/`blocked`，不得默认 PASS。
5. 错误提示只作补充，优先使用稳定业务码和字段断言。

最低回归：`[200] + code=0` 不能通过；目标为参数错误但收到认证错误不能通过。

### F02 · P0 · 新建任务后“立即执行”找不到新任务【已做处理函数验证】

位置：`frontend/src/App.tsx:368–371、419–441`。

`saveTasks([task,...tasks])` 后同步调用 `handleInitAndRun(task.id)`。该函数捕获本次渲染的旧 `tasks`，`tasks.find()` 找不到新任务，直接 return。

修改要求：执行函数接收明确的任务对象或任务配置快照，例如 `runTask(task)`；不要等待 React 状态更新后再反查，也不要用 setTimeout 掩盖问题。

最低回归：一次点击创建一个任务、提交一次运行请求；请求失败时任务进入失败状态，不能永远 pending。

### F03 · P0 · 前端多任务，后端只有一个全局流水线【代码可确认】

位置：`backend/src/main.rs:18–33`；`backend/src/api/pipeline.rs:79–86、807–821、915–942、998–1044`。

后端仅有一份 `pipeline/last_report/last_report_file/last_summary`；追问请求不带 project/task/pipeline 身份。运行 A 再运行 B 后，在 UI 选择 A 追问，后端拿到的仍是最后保存的 B。

下载地址也只代表“最近一次”，选择历史 A 点“报告文件”，可能下载 B。run_id 只是事件关联值，没有提供存储隔离。

修改要求：引入 project_id、task_id、pipeline_version、run_id；所有查询、追问、报告、事件明确归属。追问必须带预期版本，冲突返回 409。

最低回归：A/B 切换追问、下载、刷新都不能串线。第一阶段可限制全局一个正在执行的任务，但历史数据仍需独立标识。

### F04 · P0 · Cookie Jar 共享导致鉴权用例和任务相互污染【代码与库行为可确认】

位置：`backend/src/main.rs:18–25、85`；`backend/src/services/runner.rs:31–40、138–143、218–245`。

全局 `PipelineRunner` 持有启用 cookie_store 的 HTTP Client，各次执行和并发用例 clone 同一客户端。只移除手动 Cookie/Authorization 请求头，不会清空 Cookie Jar；前置登录或其他响应写入的 Cookie 仍可自动携带。

另外，用预期包含 401/403 推断 strip_auth，会把“合法登录但没有权限，应 403”的授权测试错误变成匿名测试。

修改要求：

- 登录态按 run + actor 隔离，匿名客户端必须没有已登录 Cookie。
- 显式 auth_mode：`inherit / none / invalid / actor`；不再从预期状态码推导认证模式。
- 无状态用例可共享连接池，但不能共享可变认证状态；会修改会话的用例独立运行。
- 跨用户/角色/租户越权测试应使用不同 actor 与各自资源，不能只删 token。

最低回归：同一域名连续执行不同任务不继承会话；已登录基线成功后，匿名用例仍确认不带 Cookie。reqwest 0.12.28 官方 cookie_store 文档说明其会保存响应 Cookie 并用于后续请求，见附录。

### F05 · P0 · 真实凭证进入持久化、报告、SSE 和 AI 上下文【代码可确认】

位置：`backend/src/api/pipeline.rs:258–310、915–920、959–972`；`backend/src/services/deepseek.rs:155–159`；`backend/src/services/runner.rs:265、397–414`；`frontend/src/App.tsx:85–98、235–242、428–435`。

登录取得的 token/Cookie 被写入 global_headers，随后序列化进 pipeline.json、返回给前端。追问又将整份当前流水线发给模型，因此登录凭证会进入模型请求。cURL 明文包含鉴权头，并可能随结果经全局 SSE、失败报告暴露。前端还把 DeepSeek Key、Cookie 和登录配置写入 localStorage。

修改要求：

1. 计划只保存 `secret_ref/auth_profile_id` 等引用；真实凭证在执行上下文中短时存在。
2. 发给 AI 的计划必须先脱敏；即使追问“帮我登录”，也不把密码、Cookie、token 或密钥填进 prompt。
3. SSE、API、日志、报告、错误原文、查询参数和 body 使用统一脱敏器；密钥与业务隐私字段支持配置。
4. cURL 通过环境变量占位引用凭证；脱敏结果需能在用户自行提供变量后复现。
5. 单人本地模式默认不持久化真实密钥；若提供“记住”，明确控制和删除。团队模式改用服务端秘密引用。
6. 迁移旧 pipeline/浏览器配置时清除敏感值；若曾共享含凭证报告，应由使用者按实际暴露情况处理凭证。

最低回归：用固定假凭证执行后，全文扫描计划、数据库普通字段、报告、事件与 AI mock 请求，均不得包含假凭证原文。

### F06 · P0（服务化前）· 无平台鉴权且目标/模型地址任意【代码可确认，未实施攻击验证】

位置：`backend/src/main.rs:36–59、95–135`；`backend/src/services/deepseek.rs:190–195`；`backend/src/api/pipeline.rs:98–115、354–361、1052–1057`。

平台 API 没有用户/会话鉴权，CORS 放开全部来源；客户端可指定目标 base_url 和模型 base_url。尤其 deepseek_for 按字段分别兜底：若使用后端默认 API Key，同时请求者自定义模型地址，Key 会被发到该自定义地址。

后台本就需要测试内网，不能简单禁止所有私网地址。应按部署模式限制：

- 本地单人：默认只监听 loopback，限制允许的 UI Origin，并提供会话令牌和 Origin 检查。
- 团队：平台身份认证、项目权限、目标 origin/CIDR/端口允许清单和审计。
- 模型供应商配置由服务端管理；后端默认密钥只能绑定其已批准的供应商 origin，不允许随请求改域名。
- 出站检查覆盖 DNS 解析、IPv4/IPv6、代理以及重定向；目标允许访问内网也只限项目授权范围。
- 限制文档大小、用例数、并发、响应字节数和运行总时长。

最低回归：自定义模型 host 不能取得后端兜底 Key；未授权用户不能订阅任何 run 的结果；跳转不得绕过出站限制。

### F07 · P1 · 缺少有效请求基线，AI 直接拼反例【代码可确认】

位置：`backend/src/services/deepseek.rs:27–107`；`backend/src/models/pipeline.rs`；`backend/src/services/runner.rs:48–156`。

现有流程是生成反例后立即并发发送，没有先验证一条合法请求能成功，也没有声明“从哪个有效样本只修改了哪个字段”。数据 ID 不存在、鉴权没配好、租户错了，都可能被误认为参数校验有效。

修改要求：每个 operation/scenario 先准备 fixture 和合法基线，再做单一字段变异。缺少样本或前置条件时标记 blocked。鉴权反例使用已证明可访问的登录基线，再切换匿名/低权限身份验证。

基础字段反例由确定性规则生成；AI 负责提取 PRD 规则、建议业务场景和解释差异。不是每个字段/接口都必须机械生成六类反例。

### F08 · P1 · 业务专用逻辑污染通用引擎，配置字段未生效【代码可确认】

位置：`backend/src/api/pipeline.rs:365–390、521–723`；`frontend/src/App.tsx:60–68、144–150、333–365`；`backend/src/services/deepseek.rs:89–93`。

预检固定请求 `/login/getBaseInfo`；认证固定使用展会业务的两段登录。AuthConfig 声明 method/token_json_path，但 bootstrap_auth 固定 POST、固定读取 data.token/token，并要求 token 存在，无法支持纯 Cookie 登录。前端也把路径、租户默认值等写死。

预检发生在 AI 全部生成及认证之后，错误地址仍先消耗时间与模型费用；且只用“是不是 HTML”判断目标，不验证真实 operation。

修改要求：通用 `AuthProfile/SetupStep` 支持方法、query/body/header、成功断言、提取器、Cookie 与 token；展会链路作为一个可选预设。预检放在 AI 前，使用项目显式配置的非破坏性健康检查或契约探测。不要默认对任意业务接口发探测请求。

### F09 · P1 · 追问整份重写且缺少同等校验【代码可确认】

位置：`backend/src/services/deepseek.rs:134–169`；`backend/src/api/pipeline.rs:223–247、828–852`。

初次生成会过滤 endpoint；追问则直接把模型输出交给执行器，没有重新校验 endpoint、base_url、唯一 ID、需求引用、空计划或规模限制。模型可意外改掉目标、认证配置或删用例。

修改要求：追问输出受限 Patch，绑定基础版本；服务端应用后展示 diff，再生成新版本。所有入口复用一个 validate_pipeline。AI 不得改 target、秘密引用或执行授权范围；普通“重跑”不调用 AI、不改变计划。

可保留旧的整份输出用于过渡，但必须固定不可修改字段、执行同等校验与版本比较，不能直接执行模型回写结果。

### F10 · P1 · 批次合并破坏引用，流式 ID 与最终 ID 不一致【代码可确认】

位置：`backend/src/api/pipeline.rs:189–205、761–795`；`frontend/src/App.tsx:476–484`。

需求 ID 冲突后只修改 requirement.req_id，没有同步该批 case.req_id。用例 ID 也会合并重命名，但发送给 SSE 的是合并前 part_cases，导致前端按旧 ID 覆盖，后续结果用最终 ID 又对不上。merge_pipeline 还未合并 pre_steps（当前首次 prompt 要求为空，但不能把此函数当通用合并器）。

修改要求：先分配服务器侧稳定 ID，并建立旧需求 ID → 新 ID 映射，同步更新引用；再持久化和发送最终对象。原始批次数据不能直接推给 UI。校验每个 case 引用存在，每个最终 ID 唯一。

### F11 · P1 · OpenAPI 支持不完整，空白名单时自动放行【代码可确认】

位置：`backend/src/api/pipeline.rs:394–485`；`backend/src/models/pipeline.rs:23–44`。

OpenAPI 只抽 method/path，分批仅支持自定义 endpoints；HEAD/OPTIONS 未纳入提取，`$ref`、路径级参数、security、requestBody 等没有规范化处理。输入非法 JSON 或不支持格式时返回空 endpoint 列表，初次过滤随之跳过。PRD-only 会推测接口并执行。

修改要求：输入先规范化为 ApiContract，明确支持的格式和版本；不支持时给出错误。PRD-only 允许生成草案，补齐契约/确认 operation 前不得执行。operation_id 关联契约模板；path_params/query_params 分开建模，执行时严格编码，避免 `/users/{id}` 字面量与实际 ID 的混淆。

分批按规范化 operation 和 token 预算进行；共享 schema/security 不得因切片丢失。

### F12 · P1 · 前置步骤未验证成功，变量失败被静默吞掉【代码可确认】

位置：`backend/src/services/runner.rs:58–130、248–250、383–390`。

前置只尝试解析 JSON，没有状态/业务成功断言；除变量名恰为 token 外，缺失变量写成空字符串。未解析 header 被跳过，body 字符串替换后 JSON 解析失败又恢复原值。带引号/反斜杠的变量可能无法正确注入；变量类型也被统一压成字符串。

修改要求：变量保存 JSON 类型，递归渲染 JSON 节点；区分必需与可选变量；完整占位符可保留原类型，混合字符串只允许显式字符串转换。未定义变量阻断依赖用例，而非降级为空。前置步骤支持 query、成功断言、依赖校验和清理步骤。第一阶段按有序步骤列表实施即可，有真实分支需要再扩展 DAG。

### F13 · P1 · 并发写接口无数据隔离，网络重试边界未定义【代码可确认】

位置：`backend/src/services/runner.rs:133–156`；`docs/examples/plastic-api.json` 包含订单、支付、保存和删除等 operation。

所有反例固定并发 10，没有场景、资源锁、fixture、cleanup 或幂等策略。一个错误反例若被目标接受，可能产生真实写入；并行用例还可能相互改变数据。用例需要独立性才能共享并发。

修改要求：按 operation 的真实语义配置 read_only/write/destructive，而不是只按 GET/POST。默认只启用明确批准的测试环境与读操作；写场景使用专属数据、独立标识、清理和资源串行组。业务写请求不因超时自动重试；确认支持幂等后才允许有限重试。登录/会话变更同样考虑独立性。

### F14 · P1 · 长请求承担完整生命周期，SSE 丢失不能恢复【代码可确认】

位置：`backend/src/api/pipeline.rs:94–351、855–972、1048–1084`；`frontend/src/services/api.ts`；`frontend/src/App.tsx:462–539`。

POST 等待 AI 多批生成、登录、执行与落盘全部结束；没有独立持久化任务、取消入口或总 deadline。SSE 是全局 broadcast，未写事件 ID，也不重放，Lagged 时直接丢失。UI 的 run_id 过滤不等于服务端授权。

前端初次 POST 结束只补报告，没有用返回的 pipeline/results 回补列表；追问成功主要依赖 SSE 设置报告。断流时可能“报告完成但列表为空”，追问甚至空白报告。

修改要求：POST 创建运行后立即返回 202 + run_id；后台 worker 执行；GET 快照是事实来源，SSE 只是增量。事件有 event_id/seq 并支持 Last-Event-ID，按 run 服务端过滤/鉴权；断线后快照补偿，结果按 run_id+case_id+attempt 去重。取消与 run deadline 传播到请求和 AI 调用。重启将未完成运行标记 interrupted，禁止自动重放可能写入的场景。

### F15 · P1 · 前端历史切换、追问归属和状态彼此不一致【代码可确认】

位置：`frontend/src/App.tsx:153–175、445–460、487–505、626–662`。

selectTask 只设置 activeTaskId 等展示状态，没有同步 currentTaskIdRef，也没有恢复对应聊天、执行列表或运行状态；追问又更新 currentTaskIdRef.current，可能写到上次运行任务。运行中切历史会清空列表，而后续事件继续写全局面板。重跑时计数未重置，逐条结果可能叠加旧统计。

修改要求：任务与运行数据按 ID 存储；selectedTaskId 仅控制视图，事件只更新其归属 run；聊天按 task/pipeline_version 关联，明确 selected/run 状态；统计从去重结果或服务端快照派生。刷新后请求服务端，不能把 localStorage 中的 running 永远当作真实运行。

### F16 · P1 · cURL 不是实际请求，响应读失败还会继续判定【代码可确认】

位置：`backend/src/services/runner.rs:161–215、226–270、392–414`。

cURL 用 merged_headers 构建，而真实请求可能已移除鉴权头、跳过空值，Cookie Jar 又可能自动加 Cookie；JSON 请求自动添加的 Content-Type 未必出现在 cURL。URL/头的单引号没有完整 shell 转义。URL 是字符串拼接，已有 query 再拼 `?`，query 键未编码。非法/空 method 默认猜测 POST，可能把配置错误变成写请求。

耗时在收到响应头后就停止，正文读取 `.unwrap_or_default()` 会吞掉中途断流错误；若状态已匹配 200，还可能错误通过。正文先完整读取后截断展示，没有响应大小上限。默认跟随重定向，测试看到的是最终结果，可能丢失登录重定向等证据。

修改要求：统一 PreparedRequest 构建并记录实际发送的脱敏请求；HeaderMap 处理大小写，Url/标准 query 编码器处理 URL；非法 method 拒绝。默认不跟随跳转，或逐跳校验并保存链路。读正文失败归为 error；计时含正文读取并设字节上限。cURL 从同一请求快照生成，正确转义 URL/头/body，凭证使用占位变量。匿名用例的复现不能重新带上被剥离的登录态。

### F17 · P1 · 所有异常被压成 FAIL/服务端崩溃，报告无法指导修复【代码可确认】

位置：`backend/src/services/runner.rs:277–292、312–324`；`backend/src/services/reporter.rs:48–65、117–130`。

网络错误、网关故障、断言失败、权限配置错误都进入 passed=false；所有 >=500 被描述为“服务端崩溃”，证据不足。批次 AI 生成部分失败后仍执行成功部分，报告不体现遗漏、生成完整性与覆盖范围。

修改要求：至少区分 passed/failed/blocked/error/skipped/inconclusive。5xx 保存原始证据与类别，只标记“观察到 5xx/待定位”，不能自动宣称目标崩溃。运行完成与测试通过分开；生成部分失败需标记 generation_incomplete 和缺失 operation。报告同时给出可判定用例通过率与计划执行完成率，不把 blocked 排除后宣称全量通过。

### F18 · P1 · 文件存储不是按项目隔离，持久化失败仍返回成功【代码可确认】

位置：`backend/src/db/mod.rs:21–38`；`backend/src/api/pipeline.rs:915–942`；`backend/src/services/reporter.rs:12–40`。

只有一个 JSON 文件，直接 fs::write，非原子更新；损坏 load 后静默视为无历史。流水线/报告/摘要分别更新，跨运行并发时可能互相混合。报告名只精确到秒，同项目同秒可能覆盖。报告保存失败时未清空旧 last_report_file，下载可能仍指向旧报告。重启仅恢复流水线，不恢复报告索引和运行事实。

修改要求：单实例先用 SQLite 事务管理项目、版本、运行、结果、事件和报告索引；报告文件以 run_id 命名。内存作为缓存，不作为唯一事实来源。保存失败明确标记持久化/报告状态；不能悄悄提供旧文件。迁移保留旧文件备份，损坏数据明确报错，禁止无声覆盖。

### F19 · P2 · 报告表格渲染、类型契约及维护结构【代码可确认】

位置：`frontend/src/App.tsx:1510`；`frontend/package.json`；`frontend/src/types/pipeline.ts:21–32、87–96`；`backend/src/services/reporter.rs`。

ReactMarkdown 未接入 GFM，而报告大量使用 Markdown 表格；应加入 remark-gfm 并验证真实渲染。后端 query_params 为任意 JSON，前端声明 string；AuthConfig 缺少 Cookie/免登入口等后端字段，结构可赋值让部分问题被掩盖。App.tsx 与 api/pipeline.rs 各承担过多职责。

修改要求：统一 DTO/schema，生成或校验 TS 类型；提取任务、配置、执行、聊天、报告模块。Markdown 单元格转义管道/换行，响应片段和 cURL fence 防止内容破坏格式。不要开放未净化的原始 HTML 来“修复”Markdown。

### F20 · P2 · 部署说明与实际代码不一致，无可重复发布链路【代码可确认】

位置：`README.md`、`config/.env.example`、`frontend/src/services/api.ts:7–9`、`backend/src/main.rs:64–93`、仓库完整目录。

README 仍有“待补依赖”和与现状不同的技术栈描述；未见 Dockerfile/Compose、反代配置、自动测试工作流和发布检查。后端没有 dotenv 加载，仅复制 `.env` 不会自动生效。Vite 变量属于前端构建时配置，config/.env.example 不会自动供两个进程读取。前端缺省 API 指向 localhost，远程用户会请求自己的电脑；HTTPS 页面还可能访问 HTTP 后端失败。

修改要求见第 7 节。构建生成的 tsbuildinfo 当前已入库，建议移除跟踪并加入忽略，不把本地产物当源码。

## 3. 重新安排的端到端使用流程

产品上保留“配置 → 任务 → 执行详情/报告”，将生成与执行拆开，使普通重跑可复现。

| 阶段 | 系统行为 | 失败后的行为 |
| --- | --- | --- |
| 1. 项目与环境 | 选择项目、目标、契约、认证档案、响应契约及运行策略 | 配置错误直接指出具体字段，不调用 AI |
| 2. 输入校验与预检 | 解析 API 契约，校验目标范围；执行已配置的非破坏性探测 | 标记环境/config error，停止后续 |
| 3. 生成测试草案 | 规则引擎生成字段反例；AI 补充 PRD 业务规则与建议 | 批次失败可独立重试，草案显示覆盖缺口 |
| 4. 审核计划 | 展示基线、变异字段、期望、认证身份、写操作及缺失 fixture | 缺关键参数保留草案，不自动发送 |
| 5. 固定版本 | 保存不可变计划版本与哈希，绑定凭证引用和执行范围 | 版本冲突返回 409 |
| 6. 创建运行 | API 返回 run_id，后台 worker 接管 | 排队/失败状态可查询，页面无需长连接保活任务 |
| 7. Setup 与基线 | 按身份建立认证，准备测试数据，验证正常请求 | 相应依赖分支 blocked；可独立的匿名场景按策略继续 |
| 8. 执行反例 | 对有效基线进行单一变异；独立请求有限并发，有共享状态则串行 | 记录准确类别与证据；不自动重试写入 |
| 9. Cleanup | 在成功、失败、取消路径均尽力清理测试数据 | 单独记录清理失败与残留资源，不能覆盖原始执行结果 |
| 10. 结果与报告 | 保存断言详情、覆盖缺口、请求证据和报告，按 run_id 查询 | 报告导出失败可重试，已有结果保留 |
| 11. 追问修改 | 针对指定计划版本生成 Patch，展示差异并创建新版本 | 不修改旧运行；“重跑原计划”不重新生成用例 |

第一阶段的最小可用闭环：一个已知 API 契约 + 一个显式认证档案 + 一条正常基线 + 三条参数反例 + 一条匿名反例 + 固定计划重跑 + 正确报告。不要求先做复杂 Agent、多实例或完整工作流平台。

## 4. 目标数据模型、执行状态与判定规则

### 4.1 最小持久化模型

| 实体 | 最小字段 |
| --- | --- |
| Project | id、name、owner/访问范围 |
| Environment | id、project_id、base_url、出站允许范围、响应契约、运行策略 |
| AuthProfile | id、environment_id、mode、setup_steps、secret_refs、actor 标识 |
| ApiContract | id、project_id、version、原始文档哈希、规范化 operations/schema |
| PipelineVersion | id、task_id、version、contract_id、requirements、baselines、cases、created_at、hash |
| Run | id、task_id、pipeline_version_id、environment_id、status、started_at、finished_at、deadline、generation/cleanup/report 状态 |
| CaseResult | run_id、case_id、attempt、outcome、实际状态、断言明细、脱敏请求/响应、耗时 |
| RunEvent | run_id、seq、type、payload、created_at |
| Report | run_id、artifact_path、hash、created_at、状态 |

Task 是用户组织计划/对话的入口；Run 是一次具体执行。重跑创建新 Run，修改计划创建新 PipelineVersion。所有历史快照保持不变。

执行上下文单独保存 Cookie Jar、typed variables 和实际凭证，不混入 PipelineVersion 或发送给 AI 的 DTO。

### 4.2 执行状态

运行状态建议：`queued → preparing → running → finalizing → completed`，并允许进入 `failed / cancelled / interrupted`。`completed` 仅代表执行生命周期结束，测试是否通过看结果摘要。

用例结果必须区分：

| outcome | 含义 | 示例 |
| --- | --- | --- |
| passed | 满足全部目标断言 | 数量缺失触发指定参数错误 |
| failed | 收到可判定响应，但违反目标规则 | 反例被成功接受 |
| blocked | 前置条件不满足 | 登录失败、缺 fixture、基线失败 |
| error | 执行基础设施异常 | DNS、超时、正文读取中断 |
| skipped | 根据明确策略未执行 | 写操作未启用 |
| inconclusive | 现有契约不足以判定 | 无法识别的响应包装 |

错误响应不能一律改判 blocked：目标规则本身若就是未登录应拒绝，匹配其明确认证断言时应 passed。分类必须依赖用例目标。

### 4.3 断言结构示例（目标设计，不是现有接口）

```json
{
  "case_id": "case-order-quantity-missing",
  "operation_id": "createOrder",
  "requirement_id": "req-quantity-required",
  "baseline_id": "baseline-order-valid",
  "auth_mode": "inherit",
  "mutation": {"location": "body", "pointer": "/quantity", "op": "remove"},
  "assertions": {
    "any_of": [
      {
        "all_of": [
          {"kind": "http_status_in", "value": [400, 422]},
          {"kind": "jsonpath_in", "path": "$.code", "value": ["VALIDATION_ERROR"]}
        ]
      },
      {
        "all_of": [
          {"kind": "http_status_in", "value": [200]},
          {"kind": "jsonpath_in", "path": "$.code", "value": [1001]},
          {"kind": "jsonpath_equals", "path": "$.field", "value": "quantity"}
        ]
      }
    ]
  }
}
```

上述错误码仅为假数据。实际只启用契约允许的响应分支，不凭 AI 猜测添加宽松分支。没有稳定业务码时，可使用已确认的 schema/字段断言组合，但不能只因为“非零”就通过。

## 5. API 与前端交互改造要求

以下为建议新接口，路径可调整，身份和版本约束必须保留：

| 接口 | 作用 |
| --- | --- |
| POST `/api/projects/:project_id/tasks` | 保存任务配置，不执行请求 |
| POST `/api/tasks/:task_id/plan-generations` | 异步生成草案，返回 generation_id |
| GET `/api/plan-generations/:generation_id` | 查询生成状态、批次与草案 |
| POST `/api/tasks/:task_id/pipeline-versions` | 校验并固定草案版本 |
| POST `/api/tasks/:task_id/refinements` | 基于指定版本生成受限 Patch；携带 expected_version |
| POST `/api/tasks/:task_id/runs` | 指定 pipeline_version_id 创建 Run，返回 202 + run_id |
| GET `/api/runs/:run_id` | 状态、结果摘要与当前快照 |
| GET `/api/runs/:run_id/results` | 分页结果，按 case_id 可查询 |
| GET `/api/runs/:run_id/events` | 受权限保护的 SSE，支持事件序号与补偿 |
| POST `/api/runs/:run_id/cancel` | 取消任务并进入 cleanup/finalizing |
| GET `/api/runs/:run_id/report` | 预览对应运行报告 |
| GET `/api/runs/:run_id/report/download` | 下载同一运行报告 |

请求具备幂等键，避免重复点击创建两次运行；幂等键不是让业务写接口自动重试的授权。统一错误结构：`code/message/request_id/details`，details 必须脱敏。

UI 要求：

- 配置页：普通项目不出现展会专属字段；通过预设选择启用。
- 新建任务先保存明确快照，可选择“生成计划”；已固定计划显示“执行/重跑”。
- 计划页展示正常基线、变异字段和期望，不只展示 AI 文字；可定位缺失配置。
- 执行页的 selectedTaskId/selectedRunId 与后台正在运行的任务分开；事件更新自身 run，不覆盖当前选中的其他历史。
- 断线显示连接状态，重连后拉快照；HTTP/SSE 结束处理必须幂等。
- 历史任务恢复结果、聊天和报告；报告按钮总是绑定当前 run_id。
- 提供取消、生成覆盖缺口、blocked/error 等分类；不要用一个红色 FAIL 包揽所有问题。

## 6. Codex 分阶段执行任务

请按阶段交付可审查改动。先复核仓库 HEAD；若与本文件不同，逐条确认问题是否仍存在，记录“仍存在/已修复/实现变化”，不要按旧行号盲改。不要提交真实密钥、目标 Cookie、环境私人地址或测试数据。

### 阶段 A：恢复最小可信闭环

范围：F01、F02、F04、F08、F12、F16、F17 的最小实现，以及 F03 的临时并发限制。

任务：

1. 修复新建任务启动，执行接收对象快照。
2. 提取纯断言模块和明确结果类型，删除全局“任意业务错误即通过”。
3. 增加显式 auth_mode，按 run/actor 隔离 HTTP 会话，匿名用例使用无会话客户端。
4. 通用认证配置字段必须真正生效；保留展会配置为预设，不再污染通用默认值。
5. 增加最小基线与 required extraction，变量错误必须阻断依赖场景。
6. 统一请求构建、实际请求证据、响应体错误处理和上限；修复 cURL 一致性。
7. 暂时只允许一个 active run，第二个请求明确 409/排队；不要靠前端按钮防并发。
8. 先补能捕捉已知缺陷的离线回归，再修实现。使用 mock AI/mock 目标，不依赖真实业务网络。

退出条件：没有真实 DeepSeek Key，也能在本地 mock 环境跑完“正常基线 + 三条参数反例 + 一条匿名反例”，并对故意放行的反例判 failed。

### 阶段 B：任务、计划、事件与持久化一致

范围：F03、F09、F10、F11、F14、F15、F18。

任务：

1. 使用 SQLite migration 建立最小实体，保留旧 JSON 的一次性导入与备份。
2. 服务端创建 ID、固定计划版本，追问带版本和 Patch，统一校验。
3. initial/refinement 均校验 operation、ID、引用、变量、断言、认证引用、数量、路径和授权目标。
4. 生成与执行异步化；SQLite 支持单实例持久化排队，Tokio 后台 worker 领取任务，不引入 Redis/Kafka。
5. 先保留一个 worker；后续按独立资源并发。worker 失联或重启时未完成任务进入 interrupted，恢复规则明确。
6. SSE 按 run 关联、有序、可补偿；服务端快照与结果持久化为事实来源。
7. UI 改成按 task/run 存数据，修历史切换、聊天归属、计数与下载。

退出条件：A/B 两任务在多个页面、刷新、断流、服务重启、版本冲突场景下不会串线或悄悄丢历史。

### 阶段 C：可部署的安全与运行边界

范围：F05、F06、F13。凭证继续泄漏的路径应尽早在 A/B 中封堵，不能等到本阶段才处理。

任务：

1. 秘密引用与脱敏统一实现，AI 输入输出也经过边界校验。
2. 本地模式与团队模式明确区分；部署前落实平台身份与目标授权范围。
3. 供应商地址和兜底 API Key 绑定，防止跨 origin 转发。
4. 加入运行/文档/响应大小/并发预算、取消、deadline 和出站限制。
5. 写场景有 fixture、cleanup、资源锁和幂等约束，默认不启用不明确的写 operation。

退出条件：假凭证不会进入可分享产物或 AI 请求；匿名 run 无 Cookie；取消后不再启动新请求；越界出站被拒绝；写请求没有无条件自动重试。

### 阶段 D：交付部署、CI 与维护拆分

范围：F19、F20 及第 7 节。

任务：完整部署文件、同源访问、离线 CI、恢复演练与 README；完成必要模块拆分，不以更换 UI 框架或改语言代替修复。

每阶段 Codex 必须交付：修改文件、解决的 F 编号、执行命令与结果、剩余限制、迁移与回退方式。不能只输出计划，也不能将未执行的测试写成通过。

## 7. 重新设计部署流程

### 7.1 部署目标

第一版只支持单实例 Rust 服务 + 单 worker + SQLite + 报告目录；前端为静态产物，由反向代理同源提供。目标 API 是独立被测系统。DeepSeek 只是计划生成依赖，不参与普通固定计划重跑。

不要直接把 Vite dev server 或 `cargo run` 当正式服务。先完成准确性和隔离修复，再用以下流程交付可重复部署包。本文件不代表已执行远程部署。

### 7.2 Codex 应补齐的部署文件

| 文件 | 要求 |
| --- | --- |
| `backend/Dockerfile` | 固定并验证 Rust 工具链，`cargo build --release --locked`，多阶段构建，非 root 运行，运行时保留所需 CA/TLS 依赖 |
| `frontend/Dockerfile` | 固定 Node 版本，`npm ci` + `npm run build`，仅交付静态 dist |
| `deploy/compose.yaml` | 单 API 实例，持久化数据卷，healthcheck，资源/进程约束，明确环境变量，不写入真实秘密 |
| `deploy/nginx.conf` | SPA fallback 与 `/api/` 反代分离，SSE 关闭 buffering/cache，合理 read timeout |
| `config/.env.example` | 配置说明、开发/容器默认值，真实密钥通过运行环境/秘密文件注入 |
| `rust-toolchain.toml` | 使用与 CI 和镜像一致、实际编译验证过的工具链 |
| `.github/workflows/ci.yml` | 前后端离线测试、构建和 mock 集成门禁；不需要业务凭证 |
| `docs/deployment.md` | 环境、安装、启动、预检、升级、备份、恢复、故障排查和回滚 |

注意：上表都是待实现文件，当前仓库不存在完整可用部署套件。不得把下面的目标操作命令描述为当前已可直接运行。

### 7.3 同源配置与 SSE 反代

前端 API 基址应支持空串代表同源，而非当前 `|| "http://localhost:8080"`。建议目标代码：

```ts
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
```

开发时用 Vite proxy 将 `/api` 转发本地 8080；部署时由 Nginx 转发。这样访问者不会误连自己电脑的 localhost，也避免 HTTPS 页面混合内容。Vite 的变量在构建时确定；若要复用镜像跨环境，优先同源，或实现明确的运行时公共配置。

反代示意（服务名/端口应与最终 Compose 一致）：

```nginx
location /api/ {
    proxy_pass http://api:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
}
location / {
    try_files $uri $uri/ /index.html;
}
```

API 要先匹配反代，不能回落 index.html。SSE 定时心跳，超时结合心跳间隔配置；业务 run deadline 与代理连接超时分开。

### 7.4 服务配置与持久化

- 容器内 API 监听 `0.0.0.0:8080`；当前默认 loopback 放到容器里会使其他容器无法连接。
- API 不直接暴露公网端口，由反代提供 HTTPS；单机本地默认只发布 loopback。
- SQLite/报告使用固定绝对路径的数据卷；不能依赖从 backend 还是根目录启动导致 data 位置改变。
- `.env` 需要 Compose `env_file` 或显式进程环境；后端目前不会自动读取 config/.env。前端也不会自动读取该目录。
- health 区分 liveness 与 readiness：存储、迁移、worker 状态可用于 readiness；不要因为 DeepSeek 暂时不可用就杀死可查询历史的进程。
- 版本使用实际构建 commit SHA，替换手写 build 标记。
- 优雅停机：停止领取新运行，限时处理当前任务，保存 interrupted/取消状态，执行必要清理。
- SQLite 单实例即可；不要直接让多个 API 副本共享当前文件并发运行。

### 7.5 安装与首次上线顺序（完成部署文件后）

1. 固定提交，离线测试全部通过；构建带 commit 标记的不可变镜像。
2. 准备数据卷与仅含测试账号的运行环境；配置允许目标、模型供应商及秘密引用。
3. 启动存储迁移与 API，验证 readiness，再启用前端反代。
4. 先用内置 mock 目标验收，再对指定测试环境执行已批准的只读基线。
5. 验证页面刷新、SSE 重连、报告下载、取消与服务重启。
6. 逐项启用写操作场景；每个场景必须有测试数据和清理记录。

部署套件完成后的命令入口可以统一为：

```bash
docker compose -f deploy/compose.yaml --env-file config/.env build
docker compose -f deploy/compose.yaml --env-file config/.env up -d
docker compose -f deploy/compose.yaml --env-file config/.env ps
docker compose -f deploy/compose.yaml --env-file config/.env logs --tail=100 api
```

Codex 必须在自己的可用环境实际验证这些命令和服务名，再纳入最终 README；本次仅提出目标入口。Compose 的插值文件与容器 env_file 是不同概念，配置文件中需明确传递运行变量，不能假定 `--env-file` 自动注入全部变量到容器。

### 7.6 CI 与回退

离线 PR 门禁：

```bash
# backend 目录；需要安装最终固定的 Rust 工具链
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked

# frontend 目录
npm ci
npm run test -- --run
npm run build
```

前端 test 脚本当前不存在，必须先加入实际测试框架与用例，不得直接复制为已通过检查。Rust 当前也没有足够自测，先建立回归再设门禁。锁定依赖和构建镜像；真实目标联调放在单独的受控手动流程，不在每个 PR 上执行支付、删除或写业务数据。

升级前暂停领取任务、等待或中断当前运行，并备份 SQLite 一致性快照与报告目录；不能在数据库持续写入时只拷贝主 db 文件而忽略 WAL。先在副本演练 migration，再升级。回退使用上一个已验证镜像；若存在不向后兼容 migration，同步恢复对应备份，禁止只回退二进制。

## 8. 必须具备的回归验收清单

全部使用 mock server、虚构账号和假密钥；以下是需要补的测试，不是本次已经跑过的测试。

| 编号 | 场景 | 必须结果 |
| --- | --- | --- |
| T01 | 点击“创建并执行” | 新任务发起恰好一次请求，不停留 pending |
| T02 | 反例预期业务失败，实际 200 + 成功码 | failed |
| T03 | 缺字段用例收到登录失效业务码 | 不得 passed；按目标与前置状态分类 |
| T04 | 400/422 + 指定参数错误 | passed，且断言明细可见 |
| T05 | 基线未通过 | 依赖参数反例 blocked，不生成虚假高通过率 |
| T06 | 登录成功后测试匿名/伪造 token | 请求实际无登录 Cookie，不能被 Jar 补回 |
| T07 | 合法低权限用户预期 403 | 保留其身份，验证授权，不误切匿名 |
| T08 | 连续同域不同任务/账号 | 会话、变量、资源互不继承 |
| T09 | A/B 历史切换后追问/下载 | 只修改与下载选中任务/版本/run |
| T10 | 批次 ID 重复且需求引用冲突 | 最终 ID 唯一，关联正确，SSE ID 与结果一致 |
| T11 | refine 产生越界 operation/base_url/空计划 | 拒绝执行，旧版本保留 |
| T12 | 非法 JSON/不支持契约格式/PRD-only | 明确错误或仅草案，不空白名单放行 |
| T13 | 路径参数含空格/中文，已有 query、多值参数 | 实际请求正确编码且不改变授权 origin |
| T14 | 未定义必需变量、引号/反斜杠、数值/对象变量 | 正确保类型；缺失则阻断，不静默原样回退 |
| T15 | 前置返回 401、500、非 JSON | 前置失败明确，依赖用例不继续误判 |
| T16 | 接口正文中断、超时、过大响应 | error/明确受限结果；不因 200 误通过 |
| T17 | 302 跳转登录页或不允许目标 | 保存/拒绝跳转；不把最终 200 当规则通过 |
| T18 | cURL 与实际请求对比 | 方法、URL、有效头、body 一致，秘密使用占位 |
| T19 | SSE 在生成/结果/报告期间中断 | 快照补偿，无重复计数，最终与数据库一致 |
| T20 | 重复执行提交、重复事件 | 幂等，不重复创建 run/结果 |
| T21 | 取消、deadline、服务重启 | 停止新请求；最终状态明确；不自动重放写操作 |
| T22 | AI 一批失败 | 显示生成不完整、缺失 operation，不宣称全覆盖 |
| T23 | 报告保存失败或同项目同秒运行 | 不下载旧报告，不覆盖不同 run |
| T24 | 假密钥/token/Cookie 出现在输入 | 普通持久化字段、AI 请求、SSE、报告均脱敏 |
| T25 | 自定义模型地址 + 后端兜底 Key | 拒绝跨已批准 origin 转发 |
| T26 | 非授权用户订阅其他 run | 服务端拒绝；前端过滤不能代替权限 |
| T27 | 写接口无 fixture/cleanup/批准策略 | skipped/blocked，不能默认并发发送 |
| T28 | Markdown 含表格、管道、换行、代码围栏 | 表格正常渲染且报告结构不被响应内容破坏 |
| T29 | 从另一台设备经 HTTPS 打开部署页面 | 同源 API/SSE 正常，无 localhost/混合内容问题 |
| T30 | 备份恢复与数据库迁移回退 | 历史 run、结果、报告归属可恢复 |

## 9. 给 Codex 的执行总指令

你现在接手 npcxl/bls-testS。以本文件为审查任务书，先复核当前 HEAD 与问题状态，再从阶段 A 开始实际修改。保留 Rust、React、DeepSeek，优先使断言可信、任务不串线、认证隔离、请求可复现。

执行边界：

1. 不以“前端能构建”代表流程正确，不以“模型返回合法 JSON”代表计划可执行。
2. 不通过放宽断言、忽略变量、默认写请求、把所有错误都当拦截成功来提高通过率。
3. 不将任意真实 token/Cookie/密码/API Key 送入 AI、报告或普通计划持久化。
4. 不直接对示例中的真实域名、IP、订单、支付或删除接口进行验证；使用 mock 与明确指定的测试环境。
5. 不在每次重跑重新调用 AI；计划版本固定，执行结果可追溯。
6. 不先搭建多实例、Redis、Kafka、复杂 Agent；最小单实例方案通过验收后再扩展。
7. 先修功能和确定性，再处理模块拆分与展示。每阶段提交一份可审查结果与真实验证记录。
8. 如果环境缺少工具/凭证，完成可离线部分，写明未验证范围，不编造验证成功。
9. 部署先构建可审查套件并本地/mock 验证；实际远程部署需要目标机器和运行配置，不能把文档完成写成已上线。

首次回复应简要列出：当前提交、仍存在的问题、阶段 A 的具体改动范围；随后立即执行阶段 A，不停留在泛泛建议。

## 附录 A：审查源代码链接

所有行号对应固定审查提交，后续改动应以函数和语义重新定位。

- [main.rs：状态、配置、路由与 CORS](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/backend/src/main.rs)
- [api/pipeline.rs：生成、登录、合并、追问、报告和 SSE](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/backend/src/api/pipeline.rs)
- [runner.rs：请求构造、Cookie、变量和断言](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/backend/src/services/runner.rs)
- [deepseek.rs：提示词、模型调用与整份计划回写](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/backend/src/services/deepseek.rs)
- [reporter.rs：报告与落盘](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/backend/src/services/reporter.rs)
- [db/mod.rs：JSON 文件持久化](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/backend/src/db/mod.rs)
- [models/pipeline.rs：流水线与用例类型](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/backend/src/models/pipeline.rs)
- [App.tsx：任务创建、切换、SSE、追问和报告](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/frontend/src/App.tsx)
- [services/api.ts：前端 API 地址与请求](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/frontend/src/services/api.ts)
- [types/pipeline.ts：前端类型](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/frontend/src/types/pipeline.ts)
- [package.json：依赖与脚本](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/frontend/package.json)
- [README：当前能力与启动说明](https://github.com/npcxl/bls-testS/blob/60c12d68ebda6247f01826026248c31757c229b3/README.md)

## 附录 B：实现行为参考

- [React 官方：State as a Snapshot](https://react.dev/learn/state-as-a-snapshot)：事件处理函数读取其所属渲染的状态快照，解释 F02 的状态捕获问题。
- [reqwest 0.12.28 ClientBuilder 官方文档](https://docs.rs/reqwest/0.12.28/reqwest/struct.ClientBuilder.html)：cookie_store 保存并自动发送 Cookie；同时说明 redirect 配置。版本与本仓库 Cargo.lock 中 reqwest 版本一致。

上述参考用于核对框架/库行为；具体缺陷以仓库代码与明确记录的验证为依据。
