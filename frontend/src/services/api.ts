import type {
  AuthConfig,
  DeepSeekConfig,
  InitAndRunResponse,
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
  run_id?: string;
}) {
  return postJson<InitAndRunResponse>("/api/pipeline/init-and-run", payload);
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

/** SSE：订阅 AI 解析/执行阶段事件（可选，前端用于展示进度） */
export function subscribeEvents(onMessage: (data: string) => void): () => void {
  const es = new EventSource(`${API_BASE}/api/pipeline/events`);
  es.onmessage = (e) => onMessage(e.data);
  return () => es.close();
}

export { API_BASE };
