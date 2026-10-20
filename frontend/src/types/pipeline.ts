/** 与 Rust 端 models::pipeline 对齐 */

export interface PreRequestStep {
  step_id: string;
  description: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  extract_rules: Record<string, string>;
}

export interface TestRequirement {
  req_id: string;
  module: string;
  title: string;
  business_rule: string;
  target_endpoint: string;
}

export interface NegativeTestCase {
  case_id: string;
  req_id: string;
  category: string;
  title: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query_params: Record<string, string>;
  body?: unknown;
  expected_status_codes: number[];
  expected_error_hint: string;
  /** 用例类型：negative（反例，默认）/ positive（正例，正常请求应成功） */
  case_type?: "negative" | "positive";
  /** 认证模式：inherit（沿用登录态）/ none（匿名） */
  auth_mode?: "inherit" | "none";
}

export interface TestPipeline {
  project_name: string;
  base_url: string;
  global_headers: Record<string, string>;
  pre_steps: PreRequestStep[];
  requirements: TestRequirement[];
  negative_cases: NegativeTestCase[];
}

export interface CaseExecutionResult {
  case_id: string;
  category: string;
  title: string;
  method: string;
  url: string;
  actual_status: number;
  expected_status_codes: number[];
  duration_ms: number;
  passed: boolean;
  failure_reason?: string;
  curl_reproduce: string;
  response_snippet: string;
  /** 实际发出的请求头 */
  request_headers?: Record<string, string>;
  /** 实际发出的请求体 */
  request_body?: unknown;
  /** 完整响应体（后端截断到 8KB） */
  response_body?: string;
  /** 用例类型 */
  case_type?: string;
  /** 结论：passed / failed / blocked / error / inconclusive */
  outcome?: "passed" | "failed" | "blocked" | "error" | "inconclusive";
  /** 实际请求次数（含重试） */
  attempts?: number;
}

export interface InitAndRunResponse {
  pipeline: TestPipeline;
  results: CaseExecutionResult[];
  markdown_report: string;
  total_cases: number;
  passed: number;
  failed: number;
  pass_rate: string;
  execution_summary: string;
  agent_reply?: string | null;
  /** 落盘的报告文件名（如 `订单中心_API-20261019-180000.md`） */
  report_file?: string | null;
  /** 报告目录（如 `data/reports`） */
  report_dir?: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** 前端配置的 DeepSeek 参数（缺失项由后端环境变量兜底） */
export interface DeepSeekConfig {
  api_key?: string;
  base_url?: string;
  model?: string;
}

/** 登录前置：首轮执行前先登录取 token */
export interface AuthConfig {
  login_path?: string;
  method?: string;
  body?: Record<string, unknown>;
  token_json_path?: string;
  header_name?: string;
  header_prefix?: string;
  extra_headers?: Record<string, string>;
}

/** 认证方式：无 / 直接注入 Cookie / 登录前置 */
export type TaskAuthMode = "none" | "cookie" | "login";

export interface TaskLoginConfig {
  param: string;
  userPhone: string;
  exhibitionId: string;
  boothNo: string;
  companyId: string;
  agencyId: string;
  tenantId: string;
}

/** 任务（一次自动化测试的完整生命周期） */
export interface TestTaskConfig {
  projectName: string;
  baseUrl: string;
  apiSpec: string;
  prdText: string;
  /** 认证方式（每个任务独立配置） */
  authMode?: TaskAuthMode;
  /** 直接注入的 Cookie（如 JSESSIONID=xxx），填了就跳过登录 */
  cookie?: string;
  /** 登录前置参数 */
  login?: TaskLoginConfig;
  /** 全局请求头（项目级，覆盖模型生成的同名头） */
  headers?: Record<string, string>;
}

/** 可复用的配置档案（新建任务时选择它） */
export interface TestConfig extends TestTaskConfig {
  id: string;
  name: string;
  updatedAt: string;
}

export type TestTaskStatus = "pending" | "running" | "done" | "failed";

export interface TestTask {
  id: string;
  name: string;
  status: TestTaskStatus;
  createdAt: string;
  finishedAt?: string;
  /** 绑定的配置档案 id（快照仍保存在 config 里，配置后续修改不影响历史） */
  configId?: string;
  config: TestTaskConfig;
  /** 任务已生成的反例（只生成一次，重跑直接复用；可追加） */
  cases?: NegativeTestCase[];
  total?: number;
  passed?: number;
  failed?: number;
  passRate?: string;
  reportFile?: string | null;
  markdown?: string;
  error?: string;
}

/** 一次运行的历史记录（本地保存） */
export interface RunHistoryItem {
  id: string;
  at: string;
  projectName: string;
  baseUrl: string;
  total: number;
  passed: number;
  failed: number;
  passRate: string;
  reportFile?: string | null;
  markdown: string;
}

/** SSE 事件（后端 /api/pipeline/events 推送） */
export type PipelineEventType = "stage" | "cases" | "result" | "report" | "error";

export interface PipelineEvent {
  run_id: string;
  type: PipelineEventType;
  /** stage 事件 */
  stage?: string;
  message?: string;
  /** cases 事件 */
  count?: number;
  payload?: NegativeTestCase[] | CaseExecutionResult;
  requirements?: TestRequirement[];
  pre_steps?: PreRequestStep[];
  /** 分批生成：是否为其中一批 */
  partial?: boolean;
  batch?: number;
  batches?: number;
  /** 分批合并后的累计用例数 / report 事件的总用例数 */
  total_cases?: number;
  /** report 事件 */
  markdown?: string;
  report_file?: string | null;
  report_dir?: string;
  passed?: number;
  failed?: number;
  pass_rate?: string;
}
