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
