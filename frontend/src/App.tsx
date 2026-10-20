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
  const passed =
    results.length > 0 ? results.filter((r) => r.passed).length : activeTask?.passed || 0;
  const authBlocked =
    results.length > 0
      ? results.filter(
          (r) =>
            !r.passed &&
            r.actual_status === 401 &&
            (categoryOf.get(r.case_id) || "").toLowerCase() !== "authbypass"
        ).length
      : 0;
  const failed =
    results.length > 0
      ? results.length - passed - authBlocked
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
      void taskApi.runTask(activeTask.id, ds.settings);
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
    const added = await taskApi.appendCasesToTask(
      activeTask.id,
      content,
      ds.settings
    );
    setChatLogs((prev) => [
      ...prev,
      {
        role: "assistant",
        content: added
          ? `已追加 ${added} 条反例，并用任务内全部反例重新执行。`
          : "没有追加到新反例，请调整描述或检查 DeepSeek 配置。",
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
          headers={activeTask ? activeTask.config.headers || {} : buffer.headers || {}}
          onSaveHeaders={async () => {
            await cfgApi.flushConfigs();
            await taskApi.flush();
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
