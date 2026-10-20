import type {
  CaseExecutionResult,
  NegativeTestCase,
  TaskAuthMode,
  TaskLoginConfig,
} from "./pipeline";

export type RunStatus = "idle" | "running" | "done" | "error";
export type View = "run" | "config" | "settings";

/** 每个任务独立的运行态（支持并行） */
export interface TaskRun {
  runId: string;
  status: RunStatus;
  stageMsg: string;
  cases: NegativeTestCase[];
  results: CaseExecutionResult[];
  total: number;
  markdown: string;
  reportFile: string;
  startedAt: number;
  /** 完成后总耗时（毫秒） */
  durationMs?: number;
}

export const EMPTY_RUN: TaskRun = {
  runId: "",
  status: "idle",
  stageMsg: "",
  cases: [],
  results: [],
  total: 0,
  markdown: "",
  reportFile: "",
  startedAt: 0,
};

/** 配置编辑缓冲区 */
export interface ConfigBuffer {
  projectName: string;
  baseUrl: string;
  apiSpec: string;
  prdText: string;
  authMode: TaskAuthMode;
  cookie: string;
  login: TaskLoginConfig;
  headers: Record<string, string>;
}

export interface DeepSeekSettings {
  api_key?: string;
  model?: string;
  base_url?: string;
}
