import ReactMarkdown from "react-markdown";
import { FileText, KeyRound, Loader2, Play, RefreshCw } from "lucide-react";
import type {
  CaseExecutionResult,
  ChatMessage,
  NegativeTestCase,
  TestConfig,
  TestTask,
} from "../types/pipeline";
import type { TaskRun } from "../types/ui";
import { StatsBar } from "./StatsBar";
import { CaseMatrix } from "./CaseMatrix";
import { ChatConsole } from "./ChatConsole";
import { authSummary } from "../lib/labels";

export type CenterTab = "cases" | "markdown" | "prd";

export function RunView({
  task,
  run,
  cases,
  results,
  config,
  model,
  configs,
  configId,
  onChangeConfig,
  onRun,
  centerTab,
  onTab,
  categoryFilter,
  onCategory,
  selectedCaseId,
  onSelectCase,
  elapsed,
  passed,
  failed,
  authBlocked,
  chatLogs,
  chatInput,
  onChatInput,
  onSendChat,
  onOpenAuth,
}: {
  task?: TestTask;
  run: TaskRun;
  cases: NegativeTestCase[];
  results: CaseExecutionResult[];
  config?: TestConfig;
  model: string;
  configs: TestConfig[];
  configId: string;
  onChangeConfig: (id: string) => void;
  onRun: () => void;
  centerTab: CenterTab;
  onTab: (t: CenterTab) => void;
  categoryFilter: string;
  onCategory: (v: string) => void;
  selectedCaseId: string;
  onSelectCase: (id: string) => void;
  elapsed: number;
  passed: number;
  failed: number;
  authBlocked: number;
  chatLogs: ChatMessage[];
  chatInput: string;
  onChatInput: (v: string) => void;
  onSendChat: (text?: string) => void;
  onOpenAuth: () => void;
}) {
  const auth = authSummary(task?.config);
  const endpoint = cases[0] ? `${cases[0].method} ${cases[0].path}` : "未生成接口";

  return (
    <main className="flex-1 flex flex-col min-w-0 bg-[#F8FAFC]">
      {/* 顶部工具栏 */}
      <header className="h-14 bg-white border-b border-slate-200/90 px-5 flex items-center justify-between shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              run.status === "running"
                ? "bg-amber-500 animate-pulse"
                : run.status === "error"
                ? "bg-rose-500"
                : run.status === "done"
                ? "bg-emerald-500"
                : "bg-slate-300"
            }`}
          />
          <h1 className="text-sm font-bold text-slate-900 truncate">
            {task ? task.name : "选择配置后运行"}
            <span className="ml-2 text-[11px] font-normal text-slate-400 font-mono">
              {endpoint}
            </span>
          </h1>
          <span className="px-2 py-0.5 text-[11px] rounded-full bg-slate-100 text-slate-600 font-mono shrink-0">
            {model}
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <select
            value={configId}
            onChange={(e) => onChangeConfig(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs max-w-[11rem] bg-white"
            title="选择配置"
          >
            <option value="">选择配置…</option>
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button
            onClick={onOpenAuth}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 ${
              auth.hasCookie
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            {auth.hasCookie ? auth.label : "未挂载登录态（点击配置）"}
          </button>

          <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/60">
            {(
              [
                ["cases", "反例执行矩阵"],
                ["markdown", "MD 报告"],
                ["prd", "需求与契约源"],
              ] as [CenterTab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => onTab(key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 ${
                  centerTab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                }`}
              >
                {key === "markdown" && <FileText className="w-3.5 h-3.5" />}
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={onRun}
            disabled={run.status === "running" || (!task && !configId)}
            className="px-3.5 py-1.5 rounded-lg bg-[#1a1a1a] hover:bg-black disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm shadow-black/10"
          >
            {run.status === "running" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : task ? (
              <RefreshCw className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            {run.status === "running" ? "并发测试中..." : task ? "重跑" : "运行"}
          </button>
        </div>
      </header>

      {centerTab === "cases" && (
        <>
          <StatsBar
            total={cases.length}
            passed={passed}
            failed={failed}
            authBlocked={authBlocked}
            elapsed={elapsed}
          />

          {task?.config?.authMode && task.config.authMode !== "none" && (
            <div className="mx-5 mt-1 mb-1 px-4 py-2 rounded-xl bg-white border border-slate-200 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3 text-xs min-w-0">
                <span className="px-2 py-0.5 rounded bg-[#1a1a1a] text-white font-mono text-[10px] shrink-0">
                  PRE-HOOK
                </span>
                <span className="font-medium text-slate-700 truncate">{auth.label}</span>
                <span className="font-mono text-slate-400 text-[11px] truncate">
                  {endpoint}
                </span>
              </div>
              <span className="text-[11px] text-emerald-600 shrink-0">
                已注入全部 Authenticated 反例
              </span>
            </div>
          )}

          <div className="flex-1 px-5 py-2 min-h-0 flex gap-4 overflow-hidden">
            <CaseMatrix
              cases={cases}
              results={results}
              categoryFilter={categoryFilter}
              onCategory={onCategory}
              selectedId={selectedCaseId}
              onSelect={onSelectCase}
            />
          </div>
        </>
      )}

      {centerTab === "markdown" && (
        <div className="flex-1 p-5 min-h-0">
          <div className="h-full bg-white border border-slate-200 rounded-2xl p-6 overflow-y-auto shadow-sm">
            <div className="pb-3 mb-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">
                {task?.name || "反例测试报告"}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                由后端生成，可直接导出归档
                {run.reportFile ? ` · ${run.reportFile}` : ""}
              </p>
            </div>
            {run.markdown ? (
              <div className="prose prose-slate max-w-none text-sm">
                <ReactMarkdown>{run.markdown}</ReactMarkdown>
              </div>
            ) : (
              <div className="text-xs text-slate-400">执行完成后生成报告。</div>
            )}
          </div>
        </div>
      )}

      {centerTab === "prd" && (
        <div className="flex-1 p-5 min-h-0 overflow-y-auto">
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-2">
                接口定义（API JSON）
              </h3>
              <pre className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-72 overflow-auto whitespace-pre-wrap">
                {config?.apiSpec || "（未配置接口定义）"}
              </pre>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-2">
                产品需求文档（PRD）
              </h3>
              <pre className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-72 overflow-auto whitespace-pre-wrap">
                {config?.prdText || "（未配置 PRD）"}
              </pre>
            </div>
          </div>
        </div>
      )}

      <ChatConsole
        logs={chatLogs}
        input={chatInput}
        onInput={onChatInput}
        onSend={onSendChat}
        disabled={!task || run.status === "running"}
        hasCookie={auth.hasCookie}
      />
    </main>
  );
}
