import { useMemo, useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import type { CaseExecutionResult, NegativeTestCase } from "../types/pipeline";
import { CATEGORY_STYLE } from "../lib/constants";
import { caseAuthMode, categoryLabel } from "../lib/labels";

type CaseState = "pending" | "passed" | "failed" | "auth_blocked";

function resolveState(
  c: NegativeTestCase,
  r?: CaseExecutionResult
): { state: CaseState; reason?: string } {
  if (!r) return { state: "pending" };
  if (r.passed) return { state: "passed" };
  const isAuthBypass = (c.category || "").toLowerCase() === "authbypass";
  if (r.actual_status === 401 && !isAuthBypass) {
    return { state: "auth_blocked", reason: r.failure_reason || undefined };
  }
  return { state: "failed", reason: r.failure_reason || undefined };
}

const STATE_META: Record<
  CaseState,
  { text: string; cls: string; row: string }
> = {
  passed: {
    text: "PASS",
    cls: "bg-emerald-100 text-emerald-700",
    row: "",
  },
  auth_blocked: {
    text: "401 阻断",
    cls: "bg-amber-100 text-amber-800",
    row: "",
  },
  failed: { text: "FAIL 缺陷", cls: "bg-rose-100 text-rose-700", row: "" },
  pending: { text: "待执行", cls: "bg-slate-100 text-slate-500", row: "" },
};

export function CaseMatrix({
  cases,
  results,
  categoryFilter,
  onCategory,
  selectedId,
  onSelect,
}: {
  cases: NegativeTestCase[];
  results: CaseExecutionResult[];
  categoryFilter: string;
  onCategory: (v: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const categories = useMemo(() => {
    const set = new Map<string, number>();
    cases.forEach((c) => {
      const key = c.category || "Other";
      set.set(key, (set.get(key) || 0) + 1);
    });
    return Array.from(set.entries());
  }, [cases]);

  const filtered = cases.filter((c) =>
    categoryFilter === "ALL" ? true : (c.category || "Other") === categoryFilter
  );

  const selected =
    filtered.find((c) => c.case_id === selectedId) || filtered[0] || cases[0];
  const selectedResult = selected
    ? results.find((r) => r.case_id === selected.case_id)
    : undefined;
  const state = selected ? resolveState(selected, selectedResult) : undefined;

  const payload = selected?.body ? JSON.stringify(selected.body, null, 2) : "";
  const response = selectedResult?.response_body || selectedResult?.response_snippet || "";
  const curl = selectedResult?.curl_reproduce || "";

  const copy = (text: string) => {
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className="w-[58%] bg-white border border-slate-200/90 rounded-2xl flex flex-col overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => onCategory("ALL")}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              categoryFilter === "ALL"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
            }`}
          >
            全部 ({cases.length})
          </button>
          {categories.map(([cat, count]) => (
            <button
              key={cat}
              onClick={() => onCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                categoryFilter === cat
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
              }`}
            >
              {categoryLabel(cat)} ({count})
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 && (
            <div className="p-6 text-xs text-slate-400">
              还没有反例。点右上角「运行」让 AI 生成，或在底部输入框追加。
            </div>
          )}
          {filtered.map((c) => {
            const r = results.find((x) => x.case_id === c.case_id);
            const s = resolveState(c, r);
            const meta = STATE_META[s.state];
            const active = selected?.case_id === c.case_id;
            const authMode = caseAuthMode(c);

            return (
              <div
                key={c.case_id}
                onClick={() => onSelect(c.case_id)}
                className={`px-4 py-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  active ? "bg-slate-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${
                      c.method === "POST"
                        ? "bg-slate-200 text-[#1a1a1a]"
                        : "bg-sky-100 text-sky-700"
                    }`}
                  >
                    {c.method || "GET"}
                  </span>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] font-semibold text-slate-400">
                        {c.case_id}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                          CATEGORY_STYLE[c.category] ||
                          "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {categoryLabel(c.category)}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                          authMode === "Authenticated"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                            : "bg-purple-50 text-purple-700 border border-purple-200/60"
                        }`}
                      >
                        {authMode === "Authenticated" ? "携带登录态" : "伪造 Cookie"}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-800 mt-1 truncate">
                      {c.title}
                    </div>
                    {s.reason && (
                      <div
                        className={`text-[11px] mt-1 truncate ${
                          s.state === "auth_blocked"
                            ? "text-amber-600"
                            : "text-rose-600 font-medium"
                        }`}
                      >
                        {s.reason}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right font-mono">
                    <div className="text-[11px] text-slate-500">
                      预期{" "}
                      <b className="text-slate-700">
                        {(c.expected_status_codes || []).join("/") || "4xx"}
                      </b>{" "}
                      → 实际{" "}
                      <b
                        className={
                          s.state === "passed"
                            ? "text-emerald-600"
                            : s.state === "auth_blocked"
                            ? "text-amber-600"
                            : "text-rose-600"
                        }
                      >
                        {r?.actual_status ?? "-"}
                      </b>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {r?.duration_ms != null ? `${r.duration_ms}ms` : "未执行"}
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold w-20 text-center ${meta.cls}`}
                  >
                    {meta.text}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 右侧检查器 */}
      <div className="w-[42%] bg-white border border-slate-200/90 rounded-2xl flex flex-col overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="w-4 h-4 text-[#1a1a1a] shrink-0" />
            <span className="text-xs font-bold text-slate-800 truncate">
              {selected ? `${selected.case_id} · 报文与复现检查器` : "报文与复现检查器"}
            </span>
          </div>
          <button
            onClick={() => curl && copy(curl)}
            disabled={!curl}
            className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-[11px] flex items-center gap-1 disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" /> 已复制 cURL
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" /> 复制完整 cURL
              </>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
          {!selected && (
            <div className="text-slate-400 text-xs">选择左侧用例查看详情</div>
          )}

          {selected && state && (
            <>
              <div
                className={`p-3 rounded-xl border ${
                  state.state === "passed"
                    ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                    : state.state === "auth_blocked"
                    ? "bg-amber-50/80 border-amber-200 text-amber-900"
                    : state.state === "pending"
                    ? "bg-slate-50 border-slate-200 text-slate-700"
                    : "bg-rose-50/80 border-rose-200 text-rose-900"
                }`}
              >
                <div className="font-bold mb-1">
                  {state.state === "passed"
                    ? "✅ 反例验证通过（后端成功拦截非法输入）"
                    : state.state === "auth_blocked"
                    ? "🔒 尚未测到业务逻辑（被 401 登录鉴权拦截）"
                    : state.state === "pending"
                    ? "⏳ 尚未执行"
                    : "🚨 捕获高危服务端缺陷（反例未被正确拦截）"}
                </div>
                <div className="text-[11px] leading-relaxed opacity-90">
                  {state.reason ||
                    (selectedResult
                      ? `后端返回 HTTP ${selectedResult.actual_status}，符合预期状态码 [${
                          (selected.expected_status_codes || []).join(", ") || "4xx"
                        }]。`
                      : "点右上角「运行」开始执行。")}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1 flex justify-between">
                  <span>变异请求体 (Mutated Request Body)</span>
                  <span className="font-mono text-[#1a1a1a]">
                    {selected.method} {selected.path}
                  </span>
                </div>
                <pre className="p-3 rounded-xl bg-slate-900 text-emerald-300 font-mono text-[11px] overflow-x-auto leading-relaxed max-h-56">
                  {payload || "（无请求体）"}
                </pre>
              </div>

              {selectedResult && (
                <div>
                  <div className="text-[11px] font-semibold text-slate-500 mb-1 flex justify-between">
                    <span>请求头</span>
                    <span className="font-mono text-slate-400">
                      重试 {Math.max((selectedResult.attempts || 1) - 1, 0)} 次
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    {Object.entries(selectedResult.request_headers || {}).length ===
                    0 ? (
                      <div className="px-3 py-2 text-slate-400">无</div>
                    ) : (
                      Object.entries(selectedResult.request_headers || {}).map(
                        ([k, v]) => (
                          <div
                            key={k}
                            className="px-3 py-1.5 border-b border-slate-100 last:border-0 flex gap-2"
                          >
                            <span className="font-mono text-slate-500 shrink-0">
                              {k}
                            </span>
                            <span className="font-mono text-slate-700 break-all">
                              {v}
                            </span>
                          </div>
                        )
                      )
                    )}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1 flex justify-between">
                  <span>实际响应报文 (Actual Response)</span>
                  <span className="font-mono font-bold">
                    HTTP {selectedResult?.actual_status ?? "-"}
                  </span>
                </div>
                <pre className="p-3 rounded-xl bg-slate-900 text-amber-200 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72">
                  {response || "（尚未执行，无响应）"}
                </pre>
              </div>

              <div>
                <div className="text-[11px] font-semibold text-slate-500 mb-1">
                  一键复现命令
                </div>
                <pre className="p-3 rounded-xl bg-slate-950 text-slate-300 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap leading-relaxed border border-slate-800 max-h-48">
                  {curl || "（执行后生成）"}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
