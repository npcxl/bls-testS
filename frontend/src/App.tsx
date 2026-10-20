import { useEffect, useMemo, useRef, useState } from "react";
import { NavRail } from "./components/NavRail";
import { TaskSidebar } from "./components/TaskSidebar";
import { ConfigSidebar } from "./components/ConfigSidebar";
import { RunView, type CenterTab } from "./components/RunView";
import { ConfigView } from "./components/ConfigView";
import { SettingsView } from "./components/SettingsView";
import { AuthModal } from "./components/AuthModal";
import { TaskDialog, type TaskDialogPayload } from "./components/TaskDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { useConfigs } from "./hooks/useConfigs";
import { useTasks } from "./hooks/useTasks";
import { useDeepSeek } from "./hooks/useDeepSeek";
import { API_BASE } from "./services/api";
import { EMPTY_RUN, type ConfigBuffer, type View } from "./types/ui";
import type { ChatMessage, TestTask } from "./types/pipeline";

export default function AutoTestWorkbench() {
  const ds = useDeepSeek();
  const cfgApi = useConfigs();
  const taskApi = useTasks();

  const [view, setView] = useState<View>("run");
  const [centerTab, setCenterTab] = useState<CenterTab>("cases");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskDialogMode, setTaskDialogMode] = useState<"create" | "edit">("create");
  const [taskDialogTask, setTaskDialogTask] = useState<TestTask | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<TestTask | undefined>();
  const [chatInput, setChatInput] = useState("");
  const [chatLogs, setChatLogs] = useState<ChatMessage[]>([]);
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "down">(
    "checking"
  );
  const [now, setNow] = useState(Date.now());
  const resultsRef = useRef<HTMLDivElement>(null);

  const { tasks, runs, activeTaskId, setActiveTaskId } = taskApi;
  const {
    configs,
    activeConfigId,
    activeConfig,
    buffer,
    patchBuffer,
    loadConfig,
    selectConfig,
    saveActiveConfig,
    createConfig,
    deleteConfig,
    setActiveConfigId,
  } = cfgApi;

  const activeTask = tasks.find((t) => t.id === activeTaskId);

  // 有效请求头：任务自身优先；任务为空时回落到所属配置
  const effectiveHeaders = (() => {
    const own = activeTask?.config?.headers;
    if (own && Object.keys(own).length > 0) return own;
    const bound = activeTask?.configId
      ? configs.find((c) => c.id === activeTask.configId)
      : activeConfig;
    return bound?.headers || own || {};
  })();
  const activeRun = activeTaskId ? runs[activeTaskId] || EMPTY_RUN : EMPTY_RUN;
  const cases =
    activeRun.cases.length > 0 ? activeRun.cases : activeTask?.cases || [];
  const results = activeRun.results;

  const categoryOf = useMemo(() => {
    const map = new Map<string, string>();
    cases.forEach((c) => map.set(c.case_id, c.category || ""));
    return map;
  }, [cases]);

  // 本次结果优先；历史任务（已刷新）回退到任务记录
  const total = results.length;
  const passed =
    total > 0 ? results.filter((r) => r.passed).length : activeTask?.passed || 0;
  // 优先使用后端显式结论；老数据回退到按 401 推断
  const authBlocked =
    total > 0
      ? results.filter(
          (r) =>
            r.outcome === "blocked" ||
            (!r.outcome &&
              !r.passed &&
              r.actual_status === 401 &&
              (categoryOf.get(r.case_id) || "").toLowerCase() !== "authbypass")
        ).length
      : 0;
  const errored =
    total > 0 ? results.filter((r) => r.outcome === "error").length : 0;
  const failed =
    total > 0
      ? results.filter((r) => !r.passed && r.outcome !== "blocked" && r.outcome !== "error")
          .length
      : Math.max((activeTask?.failed || 0) - authBlocked, 0);

  const elapsed =
    activeRun.status === "running" && activeRun.startedAt
      ? Math.floor((now - activeRun.startedAt) / 1000)
      : Math.round((activeRun.durationMs || 0) / 1000);

  // 计时
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  // 选中用例失效时回到第一条
  useEffect(() => {
    if (cases.length === 0) return;
    if (!cases.some((c) => c.case_id === selectedCaseId)) {
      setSelectedCaseId(cases[0].case_id);
    }
  }, [cases, selectedCaseId]);

  // 探活
  useEffect(() => {
    (async () => {
      setApiStatus("checking");
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${API_BASE}/api/health`, {
          signal: controller.signal,
        });
        window.clearTimeout(timer);
        setApiStatus(res.ok ? "ok" : "down");
      } catch {
        setApiStatus("down");
      }
    })();
  }, []);

  // 恢复上次选择
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ws_state");
      if (!raw) return;
      const ws = JSON.parse(raw);
      if (ws.view) setView(ws.view);
      if (ws.activeTaskId) setActiveTaskId(ws.activeTaskId);
      if (ws.activeConfigId) {
        const c = configs.find((x) => x.id === ws.activeConfigId);
        if (c) {
          setActiveConfigId(c.id);
          loadConfig(c);
        }
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          "ws_state",
          JSON.stringify({ view, activeTaskId, activeConfigId })
        );
      } catch {
        /* ignore */
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [view, activeTaskId, activeConfigId]);

  const handleRun = () => {
    if (activeTask) {
      const effective: TestTask = {
        ...activeTask,
        config: { ...activeTask.config, headers: effectiveHeaders },
      };
      void taskApi.runTask(activeTask.id, ds.settings, effective);
      return;
    }
    if (!activeConfigId) return;
    saveActiveConfig(activeConfigId);
    const cfg = configs.find((c) => c.id === activeConfigId);
    if (cfg) taskApi.createTaskFromConfig(cfg, true, ds.settings);
  };

  const handleSend = async (text?: string) => {
    const content = (text ?? chatInput).trim();
    if (!content || !activeTask) return;
    setChatInput("");
    setChatLogs((prev) => [
      ...prev,
      { role: "user", content },
    ]);
    const { added, error, skippedRun } = await taskApi.appendCasesToTask(
      activeTask.id,
      content,
      ds.settings
    );
    setChatLogs((prev) => [
      ...prev,
      {
        role: "assistant",
        content:
          added > 0
            ? skippedRun
              ? `已追加 ${added} 条用例（当前还有运行在进行，完成后点「重跑」即可执行新用例）。`
              : `已追加 ${added} 条用例，并用任务内全部用例重新执行。`
            : `追加失败：${error || "未知原因"}`,
      },
    ]);
  };

  /** 鉴权变更：同时写回配置与当前任务，然后重跑 */
  const applyAuth = (patch: Partial<ConfigBuffer>, rerun = true) => {
    setShowAuthModal(false);
    // 有任务时只改该任务快照；没有任务时才写共享配置
    if (activeTask) {
      const nextConfig = { ...activeTask.config, ...patch };
      taskApi.updateTask(activeTask.id, { config: nextConfig });
      if (rerun) {
        void taskApi.runTask(activeTask.id, ds.settings, {
          ...activeTask,
          config: nextConfig,
        });
      }
      return;
    }
    patchBuffer(patch);
    if (activeConfigId) saveActiveConfig(activeConfigId, patch);
  };

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] text-slate-900 font-sans overflow-hidden">
      <NavRail view={view} onChange={setView} />

      {view === "run" && (
        <TaskSidebar
          tasks={tasks}
          activeTaskId={activeTaskId}
          onSelect={(id) => {
            setActiveTaskId(id);
            const t = tasks.find((x) => x.id === id);
            const c = t?.configId ? configs.find((x) => x.id === t.configId) : undefined;
            if (c) {
              setActiveConfigId(c.id);
              loadConfig(c);
            }
            // 任务没有请求头（未设置或空对象）时，继承所属配置的请求头；
            // 已显式配置过的任务保持不变，避免互相污染
            const ownHeaders = t?.config.headers;
            const emptyHeaders = !ownHeaders || Object.keys(ownHeaders).length === 0;
            if (t && emptyHeaders && c?.headers && Object.keys(c.headers).length > 0) {
              taskApi.updateTask(t.id, {
                config: { ...t.config, headers: c.headers },
              });
            }
            setView("run");
          }}
          onNewTask={() => {
            setTaskDialogMode("create");
            setTaskDialogTask(undefined);
            setTaskDialogOpen(true);
          }}
          onEditTask={(task) => {
            setTaskDialogMode("edit");
            setTaskDialogTask(task);
            setTaskDialogOpen(true);
          }}
          onDeleteTask={(task) => setDeleteTarget(task)}
          onOpenAuth={() => setShowAuthModal(true)}
        />
      )}

      {view === "config" && (
        <ConfigSidebar
          configs={configs}
          activeConfigId={activeConfigId}
          onSelect={selectConfig}
          onCreate={() => createConfig()}
        />
      )}

      {apiStatus === "down" && (
        <div className="absolute top-0 left-0 right-0 z-40 px-5 py-1.5 bg-rose-50 border-b border-rose-200 text-[12px] text-rose-700">
          无法连接后端 <code className="font-mono">{API_BASE}</code>：请先启动
          <code className="font-mono"> cargo run</code>
        </div>
      )}

      {view === "run" && (
        <RunView
          task={activeTask}
          run={activeRun}
          cases={cases}
          results={results}
          config={activeConfig}
          model={ds.model}
          configs={configs}
          configId={activeTask?.configId || activeConfigId}
          onChangeConfig={(id) => {
            setActiveConfigId(id);
            const c = configs.find((x) => x.id === id);
            if (c) loadConfig(c);
          }}
          onRun={handleRun}
          centerTab={centerTab}
          onTab={setCenterTab}
          categoryFilter={categoryFilter}
          onCategory={setCategoryFilter}
          selectedCaseId={selectedCaseId}
          onSelectCase={setSelectedCaseId}
          elapsed={elapsed}
          passed={passed}
          failed={Math.max(failed, 0)}
          authBlocked={authBlocked}
          chatLogs={chatLogs}
          chatInput={chatInput}
          onChatInput={setChatInput}
          onSendChat={handleSend}
          onOpenAuth={() => setShowAuthModal(true)}
          headers={activeTask ? effectiveHeaders : buffer.headers || {}}
          configHeaders={activeConfig?.headers || {}}
          onInheritHeaders={() => {
            if (!activeTask) return;
            const inherited = activeConfig?.headers || {};
            taskApi.updateTask(activeTask.id, {
              config: { ...activeTask.config, headers: inherited },
            });
          }}
          onAddPositive={async () => {
            if (!activeTask) return;
            const res = await taskApi.appendCasesToTask(
              activeTask.id,
              "为每个核心接口补充合法正例（positive_cases）：使用 PRD 中的合法参数，期望返回 200/201",
              ds.settings
            );
            setChatLogs((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  res.added > 0
                    ? `已补充 ${res.added} 条用例（含正例），并重新执行。`
                    : `补充失败：${res.error || "未知原因"}`,
              },
            ]);
          }}
          onSaveHeaders={async () => {
            const okConfigs = await cfgApi.flushConfigs();
            const okTasks = await taskApi.flush();
            if (!okConfigs || !okTasks) {
              throw new Error("保存到本地数据库失败，请检查后端是否运行");
            }
          }}
          onHeadersChange={(next: Record<string, string>) => {
            // 只写当前任务快照，绝不改共享配置（否则会串到其它任务）
            if (activeTask) {
              taskApi.updateTask(activeTask.id, {
                config: { ...activeTask.config, headers: next },
              });
              return;
            }
            patchBuffer({ headers: next });
          }}
        />
      )}

      {view === "config" && (
        <ConfigView
          config={activeConfig}
          buffer={buffer}
          patchBuffer={patchBuffer}
          onHeadersChange={(h: Record<string, string>) => {
            patchBuffer({ headers: h });
            if (activeConfigId) saveActiveConfig(activeConfigId, { headers: h });
          }}
          onSave={() => saveActiveConfig()}
          onRun={() => {
            if (!activeConfigId) return;
            saveActiveConfig(activeConfigId);
            const cfg = configs.find((c) => c.id === activeConfigId);
            if (cfg) taskApi.createTaskFromConfig(cfg, true, ds.settings);
          }}
          onDelete={() => activeConfigId && deleteConfig(activeConfigId)}
        />
      )}

      {view === "settings" && (
        <SettingsView
          apiKey={ds.apiKey}
          model={ds.model}
          baseUrl={ds.baseUrl}
          onApiKey={ds.setApiKey}
          onModel={ds.setModel}
          onBaseUrl={ds.setBaseUrl}
          onClearAll={() => {
            taskApi.saveTasks([]);
            setActiveTaskId("");
            setActiveConfigId("");
            ["tasks", "configs", "run_history", "ws_state"].forEach((k) =>
              localStorage.removeItem(k)
            );
            window.location.reload();
          }}
        />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除任务</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除「{deleteTarget?.name}」？该任务的运行记录、反例缓存与聊天上下文会一并移除；
              后端已生成的报告文件仍保留在磁盘上。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(undefined)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteTarget) return;
                const rest = tasks.filter((t) => t.id !== deleteTarget.id);
                taskApi.deleteTask(deleteTarget.id);
                if (deleteTarget.id === activeTaskId) {
                  const next = rest[0];
                  setActiveTaskId(next?.id || "");
                  const c = next?.configId
                    ? configs.find((x) => x.id === next.configId)
                    : undefined;
                  if (c) {
                    setActiveConfigId(c.id);
                    loadConfig(c);
                  }
                }
                setDeleteTarget(undefined);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TaskDialog
        open={taskDialogOpen}
        mode={taskDialogMode}
        task={taskDialogTask}
        configs={configs}
        defaultConfig={activeConfig}
        onClose={() => setTaskDialogOpen(false)}
        onSubmit={(payload: TaskDialogPayload, run: boolean) => {
          if (taskDialogMode === "edit" && taskDialogTask) {
            const next: TestTask = {
              ...taskDialogTask,
              name: payload.name,
              config: payload.config,
            };
            taskApi.updateTask(taskDialogTask.id, {
              name: payload.name,
              config: payload.config,
            });
            if (run) void taskApi.runTask(taskDialogTask.id, ds.settings, next);
          } else {
            taskApi.createTaskSnapshot(payload.name, payload.config, {
              autoRun: run,
              deepseek: ds.settings,
            });
          }
          setTaskDialogOpen(false);
        }}
      />

      {showAuthModal && (
        <AuthModal
          open={showAuthModal}
          config={activeConfig}
          onClose={() => setShowAuthModal(false)}
          onSaveCookie={(cookie) =>
            applyAuth({ authMode: "cookie", cookie })
          }
          onSaveLogin={({ param, userPhone, exhibitionId }) =>
            applyAuth({
              authMode: "login",
              login: {
                ...(buffer.login || {}),
                param,
                userPhone,
                exhibitionId,
              },
            } as Partial<ConfigBuffer>)
          }
        />
      )}

      <div ref={resultsRef} className="hidden" />
    </div>
  );
}
