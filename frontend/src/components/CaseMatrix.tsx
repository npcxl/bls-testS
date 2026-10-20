import { useMemo, useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import type { CaseExecutionResult, NegativeTestCase } from "../types/pipeline";
import { CATEGORY_STYLE } from "../lib/constants";
import { caseAuthMode, categoryLabel } from "../lib/labels";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";

type CaseState =
  | "pending"
  | "passed"
  | "failed"
  | "auth_blocked"
  | "error"
  | "inconclusive";

const FILTER_POSITIVE = "POSITIVE";

function isPositive(c: NegativeTestCase) {
  return (c.case_type || "").toLowerCase() === "positive";
}

function resolveState(
  c: NegativeTestCase,
  r?: CaseExecutionResult
): { state: CaseState; reason?: string } {
  if (!r) return { state: "pending" };
  // 后端已给出显式结论，优先使用（阶段 A：不再靠状态码猜）
  if (r.outcome === "blocked") {
    return { state: "auth_blocked", reason: r.failure_reason || undefined };
  }
  if (r.outcome === "error") {
    return { state: "error", reason: r.failure_reason || undefined };
  }
  if (r.outcome === "inconclusive") {
    return { state: "inconclusive", reason: r.failure_reason || undefined };
  }
  if (r.passed) return { state: "passed" };
  const isAuthBypass = (c.category || "").toLowerCase() === "authbypass";
  if (r.actual_status === 401 && !isAuthBypass && !isPositive(c)) {
    return { state: "auth_blocked", reason: r.failure_reason || undefined };
  }
  return { state: "failed", reason: r.failure_reason || undefined };
}

const STATE_META: Record<CaseState, { text: string; cls: string }> = {
  passed: { text: "PASS", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  auth_blocked: { text: "401 阻断", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  failed: { text: "FAIL 缺陷", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  error: { text: "ERROR", cls: "border-slate-300 bg-slate-100 text-slate-700" },
  inconclusive: {
    text: "无法判定",
    cls: "border-sky-200 bg-sky-50 text-sky-700",
  },
  pending: { text: "待执行", cls: "border-border bg-secondary text-muted-foreground" },
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
      if (isPositive(c)) return;
      const key = c.category || "Other";
      set.set(key, (set.get(key) || 0) + 1);
    });
    return Array.from(set.entries());
  }, [cases]);

  const positiveCount = cases.filter(isPositive).length;

  const filtered = cases.filter((c) => {
    if (categoryFilter === "ALL") return true;
    if (categoryFilter === FILTER_POSITIVE) return isPositive(c);
    return !isPositive(c) && (c.category || "Other") === categoryFilter;
  });

  const selected =
    filtered.find((c) => c.case_id === selectedId) || filtered[0] || cases[0];
  const selectedResult = selected
    ? results.find((r) => r.case_id === selected.case_id)
    : undefined;
  const state = selected ? resolveState(selected, selectedResult) : undefined;

  const payload = selected?.body ? JSON.stringify(selected.body, null, 2) : "";
  const response =
    selectedResult?.response_body || selectedResult?.response_snippet || "";
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
      <div className="w-[58%] bg-card border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm">
        <div className="px-3 py-2.5 border-b border-border flex items-center gap-1.5 flex-wrap">
          <FilterChip
            active={categoryFilter === "ALL"}
            onClick={() => onCategory("ALL")}
            label={`全部 (${cases.length})`}
          />
          <FilterChip
            active={categoryFilter === FILTER_POSITIVE}
            onClick={() => onCategory(FILTER_POSITIVE)}
            label={`正例 (${positiveCount})`}
          />
          {categories.map(([cat, count]) => (
            <FilterChip
              key={cat}
              active={categoryFilter === cat}
              onClick={() => onCategory(cat)}
              label={`${categoryLabel(cat)} (${count})`}
            />
          ))}
        </div>

        <ScrollArea className="flex-1">
          <div className="divide-y divide-border">
            {filtered.length === 0 && (
              <div className="p-6 text-xs text-muted-foreground">
                还没有用例。点右上角「运行」让 AI 生成，或在底部输入框追加。
              </div>
            )}
            {filtered.map((c) => {
              const r = results.find((x) => x.case_id === c.case_id);
              const s = resolveState(c, r);
              const meta = STATE_META[s.state];
              const active = selected?.case_id === c.case_id;
              const authMode = caseAuthMode(c);
              const positive = isPositive(c);

              return (
                <div
                  key={c.case_id}
                  onClick={() => onSelect(c.case_id)}
                  className={`px-4 py-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    active ? "bg-secondary" : "hover:bg-secondary/50"
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${
                        c.method === "POST"
                          ? "bg-secondary text-foreground"
                          : "bg-sky-50 text-sky-700"
                      }`}
                    >
                      {c.method || "GET"}
                    </span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                          {c.case_id}
                        </span>
                        <Badge variant={positive ? "info" : "outline"}>
                          {positive ? "正例" : "反例"}
                        </Badge>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                            CATEGORY_STYLE[c.category] || "border-border bg-secondary"
                          }`}
                        >
                          {positive ? "正常请求" : categoryLabel(c.category)}
                        </span>
                        <Badge variant={authMode === "Authenticated" ? "success" : "outline"}>
                          {authMode === "Authenticated" ? "携带登录态" : "伪造 Cookie"}
                        </Badge>
                      </div>
                      <div className="text-xs font-semibold text-foreground mt-1 truncate">
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
                      <div className="text-[11px] text-muted-foreground">
                        预期{" "}
                        <b className="text-foreground">
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
                      <div className="text-[10px] text-muted-foreground">
                        {r?.duration_ms != null ? `${r.duration_ms}ms` : "未执行"}
                      </div>
                    </div>

                    <Badge variant="outline" className={`w-20 justify-center ${meta.cls}`}>
                      {meta.text}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* 右侧检查器 */}
      <div className="w-[42%] bg-card border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-secondary/60">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold truncate">
              {selected ? `${selected.case_id} · 报文与复现检查器` : "报文与复现检查器"}
            </span>
          </div>
          <Button
            size="sm"
            disabled={!curl}
            onClick={() => curl && copy(curl)}
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" /> 已复制 cURL
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" /> 复制完整 cURL
              </>
            )}
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-3.5 text-xs">
            {!selected && (
              <div className="text-muted-foreground text-xs">选择左侧用例查看详情</div>
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
                      ? "bg-secondary border-border text-foreground"
                      : state.state === "error"
                      ? "bg-slate-50 border-border text-foreground"
                      : state.state === "inconclusive"
                      ? "bg-sky-50/80 border-sky-200 text-sky-900"
                      : "bg-rose-50/80 border-rose-200 text-rose-900"
                  }`}
                >
                  <div className="font-bold mb-1">
                    {state.state === "passed"
                      ? "✅ 用例通过（行为符合预期）"
                      : state.state === "auth_blocked"
                      ? "🔒 前置阻断（登录态/权限不满足，未触达业务规则）"
                      : state.state === "pending"
                      ? "⏳ 尚未执行"
                      : state.state === "error"
                      ? "⚠️ 执行异常（网络/超时/响应读取失败）"
                      : state.state === "inconclusive"
                      ? "❔ 无法判定（响应体缺少可判定的业务码）"
                      : "🚨 捕获缺陷（结果与预期不符）"}
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
                  <div className="text-[11px] font-semibold text-muted-foreground mb-1 flex justify-between">
                    <span>请求体 (Request Body)</span>
                    <span className="font-mono">
                      {selected.method} {selected.path}
                    </span>
                  </div>
                  <pre className="p-3 rounded-xl bg-slate-900 text-emerald-300 font-mono text-[11px] overflow-x-auto leading-relaxed max-h-56">
                    {payload || "（无请求体）"}
                  </pre>
                </div>

                {selectedResult && (
                  <div>
                    <div className="text-[11px] font-semibold text-muted-foreground mb-1 flex justify-between">
                      <span>请求头</span>
                      <span className="font-mono">
                        重试 {Math.max((selectedResult.attempts || 1) - 1, 0)} 次
                      </span>
                    </div>
                    <div className="rounded-xl border border-border overflow-hidden">
                      {Object.entries(selectedResult.request_headers || {}).length ===
                      0 ? (
                        <div className="px-3 py-2 text-muted-foreground">无</div>
                      ) : (
                        Object.entries(selectedResult.request_headers || {}).map(
                          ([k, v]) => (
                            <div
                              key={k}
                              className="px-3 py-1.5 border-b border-border last:border-0 flex gap-2"
                            >
                              <span className="font-mono text-muted-foreground shrink-0">
                                {k}
                              </span>
                              <span className="font-mono text-foreground break-all">
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
                  <div className="text-[11px] font-semibold text-muted-foreground mb-1 flex justify-between">
                    <span>实际响应报文</span>
                    <span className="font-mono font-bold">
                      HTTP {selectedResult?.actual_status ?? "-"}
                    </span>
                  </div>
                  <pre className="p-3 rounded-xl bg-slate-900 text-amber-200 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72">
                    {response || "（尚未执行，无响应）"}
                  </pre>
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground mb-1">
                    一键复现命令
                  </div>
                  <pre className="p-3 rounded-xl bg-slate-950 text-slate-300 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap leading-relaxed border border-slate-800 max-h-48">
                    {curl || "（执行后生成）"}
                  </pre>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-muted-foreground hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}
