import { API_BASE } from "../services/api";

export function friendlyError(e: unknown) {
  const msg = (e as Error)?.message || String(e);
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return `无法连接后端（${API_BASE}），请确认已运行 cargo run 且 8080 端口未被占用。`;
  }
  return msg;
}
