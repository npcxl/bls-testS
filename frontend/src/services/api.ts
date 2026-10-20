import type {
  AuthConfig,
  DeepSeekConfig,
  InitAndRunResponse,
  NegativeTestCase,
  TestPipeline,
} from "../types/pipeline";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:8080";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `请求失败: HTTP ${res.status}`);
  }
  return JSON.parse(text) as T;
}

/** 首轮：接口 JSON + PRD + BaseURL → 生成反例并执行 */
export function initAndRun(payload: {
  project_name: string;
  base_url: string;
  api_spec: string;
  prd_content: string;
  deepseek?: DeepSeekConfig;
  auth?: AuthConfig;
  extra_headers?: Record<string, string>;
  run_id?: string;
}) {
  return postJson<InitAndRunResponse>("/api/pipeline/init-and-run", payload);
}

/** 执行任务里已有的反例（不调用 AI，不重新生成） */
export function executePipeline(payload: {
  pipeline: TestPipeline;
  auth?: AuthConfig;
  run_id?: string;
}) {
  return postJson<InitAndRunResponse>("/api/pipeline/execute", payload);
}

/** 追加反例：只生成新增用例，不重复已有 */
export function appendCases(payload: {
  instruction: string;
  api_spec?: string;
  prd_content?: string;
  existing_cases: NegativeTestCase[];
  deepseek?: DeepSeekConfig;
  run_id?: string;
}) {
  return postJson<{ added: NegativeTestCase[]; total: number }>(
    "/api/pipeline/append-cases",
    payload
  );
}

/** 追问：自然语言指令 → 更新流水线并重跑 */
export function chatRefine(
  instruction: string,
  deepseek?: DeepSeekConfig,
  runId?: string
) {
  return postJson<InitAndRunResponse>("/api/pipeline/chat-refine-and-run", {
    instruction,
    deepseek,
    run_id: runId,
  });
}

/** 本地数据库（后端 SQLite）：读取某个 key */
export async function getStore<T>(key: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}/api/store/${key}`);
    if (!res.ok) return null;
    const data = (await res.json()) as T | null;
    return data ?? null;
  } catch {
    return null;
  }
}

/** 本地数据库（后端 SQLite）：整份写入 */
export async function putStore(key: string, value: unknown): Promise<void> {
  await fetch(`${API_BASE}/api/store/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

/** SSE：订阅 AI 解析/执行阶段事件（可选，前端用于展示进度） */
export function subscribeEvents(onMessage: (data: string) => void): () => void {
  const es = new EventSource(`${API_BASE}/api/pipeline/events`);
  es.onmessage = (e) => onMessage(e.data);
  return () => es.close();
}

export { API_BASE };
