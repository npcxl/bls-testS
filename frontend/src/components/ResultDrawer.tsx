import { X } from "lucide-react";
import type { CaseExecutionResult } from "../types/pipeline";
import { CATEGORY_STYLE } from "../lib/constants";
import { KV, Section } from "./ui";

/** 结果详情（Postman 风格：请求头 / 请求体 / 响应 / cURL） */
export function ResultDrawer({
  result,
  onClose,
}: {
  result: CaseExecutionResult;
  onClose: () => void;
}) {
  const headers = Object.entries(result.request_headers || {});
  const bodyText = result.request_body
    ? JSON.stringify(result.request_body, null, 2)
    : "";
  const respText = result.response_body || result.response_snippet || "";

  return (
    <div className="absolute inset-0 z-30 flex">
      <div
        className="flex-1 bg-slate-900/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="w-[560px] max-w-full bg-white border-l border-slate-200 flex flex-col shadow-2xl">
        <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">
              {result.case_id} · {result.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span
                className={`px-1.5 py-0.5 rounded border ${
                  CATEGORY_STYLE[result.category] ||
                  "bg-slate-100 text-slate-600 border-slate-300"
                }`}
              >
                {result.category}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded border ${
                  result.passed
                    ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                    : "bg-rose-50 text-rose-600 border-rose-200"
                }`}
              >
                {result.passed ? "PASS" : "FAIL"}
              </span>
              <span className="text-slate-400">耗时 {result.duration_ms}ms</span>
              <span className="text-slate-400">
                重试 {Math.max((result.attempts || 1) - 1, 0)} 次
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-slate-100 text-[#1a1a1a] border border-slate-300 font-mono">
              {result.method}
            </span>
            <span className="font-mono text-slate-600 break-all">{result.url}</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <KV label="实际状态码" value={String(result.actual_status || "ERR")} />
            <KV
              label="预期状态码"
              value={result.expected_status_codes?.join(", ") || "默认 4xx"}
            />
            <KV label="请求次数" value={String(result.attempts || 1)} />
          </div>

          {result.failure_reason && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
              {result.failure_reason}
            </div>
          )}

          <Section title={`请求头（${headers.length}）`}>
            {headers.length === 0 ? (
              <div className="text-slate-400">无</div>
            ) : (
              <table className="w-full text-[11px]">
                <tbody>
                  {headers.map(([k, v]) => (
                    <tr key={k} className="border-b border-slate-100">
                      <td className="py-1 pr-2 text-slate-500 font-mono align-top whitespace-nowrap">
                        {k}
                      </td>
                      <td className="py-1 font-mono text-slate-700 break-all">
                        {v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="请求体">
            {bodyText ? (
              <pre className="bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto text-[11px] leading-relaxed max-h-64">
                {bodyText}
              </pre>
            ) : (
              <div className="text-slate-400">无请求体</div>
            )}
          </Section>

          <Section title="响应体">
            {respText ? (
              <pre className="bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto text-[11px] leading-relaxed max-h-80 whitespace-pre-wrap break-all">
                {respText}
              </pre>
            ) : (
              <div className="text-slate-400">无响应体</div>
            )}
          </Section>

          <Section title="复现 cURL">
            <pre className="bg-slate-900 text-slate-100 rounded p-2 overflow-x-auto text-[11px] leading-relaxed whitespace-pre-wrap break-all">
              {result.curl_reproduce}
            </pre>
          </Section>
        </div>
      </aside>
    </div>
  );
}
