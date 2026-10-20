import { useState } from "react";
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
import { API_BASE } from "../services/api";
import { HeadersEditor } from "./HeadersEditor";
import { ReportView } from "./ReportView";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

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
  headers,
  onHeadersChange,
  onSaveHeaders,
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
  headers: Record<string, string>;
  onHeadersChange: (next: Record<string, string>) => void;
  onSaveHeaders: () => Promise<void> | void;
}) {
  const [saved, setSaved] = useState(false);
  const auth = authSummary(task?.config);
  const endpoint = cases[0] ? `${cases[0].method} ${cases[0].path}` : "未生成接口";
  // 报告：本次运行优先，刷新/切任务后回退到任务里持久化的内容
  const md = run.markdown || task?.markdown || "";
  const mdFile = run.reportFile || task?.reportFile || "";
  const positiveCount = cases.filter(
    (c) => (c.case_type || "").toLowerCase() === "positive"
  ).length;
  const negativeCount = cases.length - positiveCount;

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
          {cases.length > 0 && (
            <span className="px-2 py-0.5 text-[11px] rounded-full bg-slate-100 text-slate-600 shrink-0">
              正例 {positiveCount} · 反例 {negativeCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-[11rem]">
            <Select value={configId} onValueChange={onChangeConfig}>
              <SelectTrigger>
                <SelectValue placeholder="选择配置…" />
              </SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            onClick={onOpenAuth}
            className={
              auth.hasCookie
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }
          >
            <KeyRound className="w-3.5 h-3.5" />
            {auth.hasCookie ? auth.label : "未挂载登录态（点击配置）"}
          </Button>

          <Tabs value={centerTab} onValueChange={(v) => onTab(v as CenterTab)}>
            <TabsList>
              <TabsTrigger value="cases">用例矩阵</TabsTrigger>
              <TabsTrigger value="markdown">
                <FileText className="w-3.5 h-3.5" /> MD 报告
              </TabsTrigger>
              <TabsTrigger value="prd">需求与契约源</TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            onClick={onRun}
            disabled={run.status === "running" || (!task && !configId)}
          >
            {run.status === "running" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : task ? (
              <RefreshCw className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            {run.status === "running" ? "并发测试中..." : task ? "重跑" : "运行"}
          </Button>
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
        <ReportView
          markdown={md}
          fileName={mdFile}
          title={`${task?.name || "测试任务"} · 自动化测试报告`}
          baseUrl={task?.config.baseUrl}
          total={cases.length}
          passed={passed}
          failed={failed}
        />
      )}

      {centerTab === "prd" && (
        <div className="flex-1 p-5 min-h-0 overflow-y-auto">
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900">全局请求头</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  仅对**当前任务的所有接口**追加这些请求头（同名时覆盖模型生成的默认头），
                  不会影响其它任务；修改后下次执行生效。
                </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {saved && (
                    <span className="text-[11px] text-emerald-600">已保存到本地数据库</span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await onSaveHeaders();
                      setSaved(true);
                      window.setTimeout(() => setSaved(false), 1800);
                    }}
                  >
                    保存
                  </Button>
                </div>
              </div>
              <HeadersEditor headers={headers} onChange={onHeadersChange} />
            </div>

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
