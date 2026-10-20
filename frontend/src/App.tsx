import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Play,
  FileDown,
  Upload,
  Braces,
  KeyRound,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  FileText,
  LogIn,
  ListTodo,
  SlidersHorizontal,
  Settings,
  Plus,
  Cookie,
  X,
  Trash2,
} from "lucide-react";
import { API_BASE, chatRefine, initAndRun, subscribeEvents } from "./services/api";
import type {
  CaseExecutionResult,
  ChatMessage,
  NegativeTestCase,
  PipelineEvent,
  RunHistoryItem,
  TaskAuthMode,
  TestConfig,
  TestTask,
  TestTaskConfig,
} from "./types/pipeline";

const SAMPLE_API_SPEC = `{
  "project": "订单中心",
  "base_url": "https://api.example.com",
  "endpoints": [
    {
      "method": "POST",
      "path": "/api/v1/orders",
      "summary": "创建订单",
      "auth": "Bearer",
      "body": {
        "sku_id": "string, required",
        "quantity": "int, required, 1~99",
        "coupon_code": "string, optional"
      },
      "responses": { "200": "创建成功", "400": "参数校验失败", "401": "未登录" }
    }
  ]
}`;

const SAMPLE_PRD = `接口：POST /api/v1/orders 创建订单
必填字段：sku_id (string), quantity (int, 1~99), coupon_code (optional string)。
业务规则：下单数量不可为 0 或负数；单笔最大 99 件；未登录用户禁止下单。`;

const EMPTY_LOGIN = {
  param: "",
  userPhone: "",
  exhibitionId: "",
  boothNo: "",
  companyId: "",
  agencyId: "",
  tenantId: "358",
};

const CATEGORY_STYLE: Record<string, string> = {
  MissingField: "bg-rose-50 text-rose-600 border-rose-200",
  InvalidType: "bg-amber-50 text-amber-600 border-amber-200",
  BoundaryOverflow: "bg-orange-50 text-orange-600 border-orange-200",
  NullValue: "bg-sky-50 text-sky-600 border-sky-200",
  SecurityInjection: "bg-purple-50 text-purple-600 border-purple-200",
  BusinessLogicViolation: "bg-indigo-50 text-indigo-600 border-indigo-200",
  AuthBypass: "bg-slate-100 text-slate-600 border-slate-300",
};

type RunStatus = "idle" | "running" | "done" | "error";
type View = "run" | "config" | "settings";

export default function AutoTestWorkbench() {
  // ---------------- 全局设置 ----------------
  const [dsKey, setDsKey] = useState<string>(
    () => localStorage.getItem("ds_api_key") || ""
  );
  const [dsModel, setDsModel] = useState<string>(
    () => localStorage.getItem("ds_model") || "deepseek-chat"
  );
  const [dsBase, setDsBase] = useState<string>(
    () => localStorage.getItem("ds_base_url") || "https://api.deepseek.com"
  );
  useEffect(() => {
    localStorage.setItem("ds_api_key", dsKey);
    localStorage.setItem("ds_model", dsModel);
    localStorage.setItem("ds_base_url", dsBase);
  }, [dsKey, dsModel, dsBase]);

  // ---------------- 配置档案 ----------------
  const [configs, setConfigs] = useState<TestConfig[]>(() => {
    try {
      const raw = localStorage.getItem("configs");
      if (raw) return JSON.parse(raw) as TestConfig[];
      return [];
    } catch {
      return [];
    }
  });
  const [activeConfigId, setActiveConfigId] = useState<string>("");

  // ---------------- 任务 ----------------
  const [tasks, setTasks] = useState<TestTask[]>(() => {
    try {
      const raw = localStorage.getItem("tasks");
      if (raw) return JSON.parse(raw) as TestTask[];
      const hist = JSON.parse(localStorage.getItem("run_history") || "[]");
      return (hist as RunHistoryItem[]).map((h, i) => ({
        id: `migrated-${i}`,
        name: `${h.projectName} · ${h.at}`,
        status: "done" as const,
        createdAt: h.at,
        config: {
          projectName: h.projectName,
          baseUrl: h.baseUrl,
          apiSpec: "",
          prdText: "",
          authMode: "none" as TaskAuthMode,
        },
        total: h.total,
        passed: h.passed,
        failed: h.failed,
        passRate: h.passRate,
        reportFile: h.reportFile,
        markdown: h.markdown,
      }));
    } catch {
      return [];
    }
  });
  const [activeTaskId, setActiveTaskId] = useState<string>("");

  // 配置编辑缓冲区
  const [projectName, setProjectName] = useState("橡塑展");
  const [baseUrl, setBaseUrl] = useState("http://10.12.1.25:48997");
  const [apiSpec, setApiSpec] = useState(SAMPLE_API_SPEC);
  const [prdText, setPrdText] = useState(SAMPLE_PRD);
  const [authMode, setAuthMode] = useState<TaskAuthMode>("none");
  const [cookie, setCookie] = useState("");
  const [login, setLogin] = useState({ ...EMPTY_LOGIN });
  const [importName, setImportName] = useState("");

  // ---------------- 运行态 ----------------
  const [view, setView] = useState<View>("run");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [stageMsg, setStageMsg] = useState("");
  const [cases, setCases] = useState<NegativeTestCase[]>([]);
  const [results, setResults] = useState<CaseExecutionResult[]>([]);
  const [total, setTotal] = useState(0);
  const [markdownReport, setMarkdownReport] = useState("");
  const [reportFile, setReportFile] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "down">(
    "checking"
  );
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<RunHistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("run_history") || "[]");
    } catch {
      return [];
    }
  });
  const [creatingTask, setCreatingTask] = useState(false);
  const [newTaskConfigId, setNewTaskConfigId] = useState("");

  // ---------------- 迁移：老任务 -> 配置档案 ----------------
  useEffect(() => {
    if (configs.length > 0) return;
    const migrated: TestConfig[] = [];
    const seen = new Set<string>();
    tasks.forEach((t) => {
      const key = `${t.config?.projectName}|${t.config?.baseUrl}`;
      if (!t.config || seen.has(key)) return;
      seen.add(key);
      migrated.push({
        id: `cfg-${Date.now()}-${migrated.length}`,
        name: t.config.projectName || `配置 ${migrated.length + 1}`,
        updatedAt: new Date().toLocaleString(),
        ...t.config,
      });
    });
    if (migrated.length > 0) {
      setConfigs(migrated);
      setActiveConfigId(migrated[0].id);
      try {
        localStorage.setItem("configs", JSON.stringify(migrated));
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- 工具 ----------------
  const persist = <T,>(key: string, value: T) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  };

  const saveTasks = (next: TestTask[]) => {
    setTasks(next);
    persist("tasks", next);
  };

  const updateTask = (id: string, patch: Partial<TestTask>) => {
    if (!id) return;
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
      persist("tasks", next);
      return next;
    });
  };

  const saveConfigs = (next: TestConfig[]) => {
    setConfigs(next);
    persist("configs", next);
  };

  const currentConfig = (): TestTaskConfig => ({
    projectName,
    baseUrl,
    apiSpec,
    prdText,
    authMode,
    cookie,
    login,
  });

  const loadConfig = (cfg: TestConfig) => {
    setProjectName(cfg.projectName || "");
    setBaseUrl(cfg.baseUrl || "");
    setApiSpec(cfg.apiSpec || "");
    setPrdText(cfg.prdText || "");
    setAuthMode(cfg.authMode || "none");
    setCookie(cfg.cookie || "");
    setLogin({ ...EMPTY_LOGIN, ...(cfg.login || {}) });
  };

  const saveActiveConfig = (id = activeConfigId) => {
    if (!id) return;
    const payload = currentConfig();
    setConfigs((prev) => {
      const next = prev.map((c) =>
        c.id === id
          ? {
              ...c,
              ...payload,
              name: payload.projectName.trim() || c.name,
              updatedAt: new Date().toLocaleString(),
            }
          : c
      );
      persist("configs", next);
      return next;
    });
  };

  const createConfig = () => {
    saveActiveConfig();
    const cfg: TestConfig = {
      id: `cfg-${Date.now()}`,
      name: `新配置 ${configs.length + 1}`,
      updatedAt: new Date().toLocaleString(),
      projectName: `新配置 ${configs.length + 1}`,
      baseUrl: "",
      apiSpec: "",
      prdText: "",
      authMode: "none",
      cookie: "",
      login: { ...EMPTY_LOGIN },
    };
    saveConfigs([cfg, ...configs].slice(0, 50));
    setActiveConfigId(cfg.id);
    loadConfig(cfg);
    setView("config");
    return cfg;
  };

  const deleteConfig = (id: string) => {
    const next = configs.filter((c) => c.id !== id);
    saveConfigs(next);
    if (activeConfigId === id) {
      setActiveConfigId(next[0]?.id || "");
      if (next[0]) loadConfig(next[0]);
    }
  };

  const activeConfig = configs.find((c) => c.id === activeConfigId);

  // ---------------- 运行 ----------------
  const runIdRef = useRef<string>("");
  const startAtRef = useRef<number>(0);
  const currentTaskIdRef = useRef<string>("");
  const resultsRef = useRef<HTMLDivElement>(null);
  const apiFileRef = useRef<HTMLInputElement>(null);
  const prdFileRef = useRef<HTMLInputElement>(null);

  const passed = useMemo(() => results.filter((r) => r.passed).length, [results]);
  const failed = results.length - passed;
  const activeTask = tasks.find((t) => t.id === activeTaskId);

  const beginRun = () => {
    const rid = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    runIdRef.current = rid;
    startAtRef.current = Date.now();
    setCases([]);
    setResults([]);
    setTotal(0);
    setMarkdownReport("");
    setReportFile("");
    setElapsed(0);
    setStatus("running");
    setStageMsg("提交中…");
    return rid;
  };

  const buildAuth = (cfg: TestTaskConfig) => {
    const extra = Object.fromEntries(
      Object.entries({
        "agency-id": (cfg.login?.agencyId || "").trim(),
        "tenant-id": (cfg.login?.tenantId || "").trim(),
      }).filter(([, v]) => v)
    );
    if (cfg.authMode === "cookie" && cfg.cookie?.trim()) {
      return { cookie: cfg.cookie.trim(), extra_headers: extra };
    }
    if (cfg.authMode === "login" && cfg.login?.userPhone?.trim()) {
      const l = cfg.login;
      return {
        login_path: "/login/syncLogin",
        method: "POST",
        body: Object.fromEntries(
          Object.entries({
            userPhone: l.userPhone.trim(),
            companyId: l.companyId.trim(),
            boothNo: l.boothNo.trim(),
            exhibitionId: l.exhibitionId.trim(),
            expoId: l.exhibitionId.trim(),
          }).filter(([, v]) => v)
        ),
        param: l.param?.trim() || undefined,
        exhibition_id: l.exhibitionId?.trim() || undefined,
        token_json_path: "$.data.token|$.token",
        header_name: "Authorization",
        header_prefix: "Bearer ",
        extra_headers: extra,
      };
    }
    return undefined;
  };

  const handleInitAndRun = async (taskId: string) => {
    if (status === "running") return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const cfg = task.config;
    currentTaskIdRef.current = taskId;
    setActiveTaskId(taskId);
    updateTask(taskId, { status: "running", error: undefined });
    setView("run");
    const rid = beginRun();
    try {
      const data = await initAndRun({
        project_name: cfg.projectName,
        base_url: cfg.baseUrl,
        api_spec: cfg.apiSpec,
        prd_content: cfg.prdText,
        deepseek: {
          api_key: dsKey.trim() || undefined,
          model: dsModel.trim() || undefined,
          base_url: dsBase.trim() || undefined,
        },
        auth: buildAuth(cfg),
        run_id: rid,
      });
      if (!markdownReport) {
        setMarkdownReport(data.markdown_report);
        setReportFile(data.report_file || "");
      }
      updateTask(taskId, {
        status: "done",
        total: data.total_cases,
        passed: data.passed,
        failed: data.failed,
        passRate: data.pass_rate,
        reportFile: data.report_file,
        markdown: data.markdown_report,
        finishedAt: new Date().toLocaleString(),
      });
      setStatus("done");
    } catch (e) {
      updateTask(taskId, {
        status: "failed",
        error: friendlyError(e),
        finishedAt: new Date().toLocaleString(),
      });
      setStatus("error");
      setStageMsg(friendlyError(e));
    }
  };

  /** 用某个配置新建任务（并立即执行） */
  const createTaskFromConfig = (configId: string, autoRun = true) => {
    const cfg = configs.find((c) => c.id === configId);
    if (!cfg) return;
    const task: TestTask = {
      id: `task-${Date.now()}`,
      name: `${cfg.projectName || cfg.name} · ${new Date().toLocaleTimeString()}`,
      status: "pending",
      createdAt: new Date().toLocaleString(),
      configId: cfg.id,
      config: {
        projectName: cfg.projectName,
        baseUrl: cfg.baseUrl,
        apiSpec: cfg.apiSpec,
        prdText: cfg.prdText,
        authMode: cfg.authMode,
        cookie: cfg.cookie,
        login: cfg.login,
      },
    };
    saveTasks([task, ...tasks].slice(0, 30));
    setActiveTaskId(task.id);
    setCreatingTask(false);
    if (autoRun) void handleInitAndRun(task.id);
    else setView("config");
  };

  const selectTask = (task: TestTask) => {
    setActiveTaskId(task.id);
    setMarkdownReport(task.markdown || "");
    setReportFile(task.reportFile || "");
    setTotal(task.total || 0);
    setCases([]);
    setResults([]);
    if (task.configId) {
      const cfg = configs.find((c) => c.id === task.configId);
      if (cfg) {
        setActiveConfigId(cfg.id);
        loadConfig(cfg);
      }
    }
    setView("run");
  };

  // ---------------- SSE ----------------
  useEffect(() => {
    const close = subscribeEvents((data) => {
      let evt: PipelineEvent;
      try {
        evt = JSON.parse(data) as PipelineEvent;
      } catch {
        return;
      }
      if (!evt.run_id || evt.run_id !== runIdRef.current) return;
      switch (evt.type) {
        case "stage":
          setStageMsg(evt.message || evt.stage || "");
          break;
        case "cases": {
          const list = (evt.payload as NegativeTestCase[]) || [];
          setCases((prev) => {
            if (!evt.partial) return list;
            const map = new Map(prev.map((c) => [c.case_id, c]));
            list.forEach((c) => map.set(c.case_id, c));
            return Array.from(map.values());
          });
          setTotal(evt.partial ? evt.total_cases || list.length : list.length);
          break;
        }
        case "result": {
          const item = evt.payload as CaseExecutionResult;
          setResults((prev) => [...prev, item]);
          const tid = currentTaskIdRef.current;
          if (tid) {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === tid
                  ? {
                      ...t,
                      total: (t.total || 0) + 1,
                      passed: (t.passed || 0) + (item.passed ? 1 : 0),
                      failed: (t.failed || 0) + (item.passed ? 0 : 1),
                    }
                  : t
              )
            );
          }
          break;
        }
        case "report":
          setMarkdownReport(evt.markdown || "");
          setReportFile(evt.report_file || "");
          setStageMsg(
            `执行完成：${evt.total_cases} 个反例，通过 ${evt.passed}，失败 ${evt.failed}，通过率 ${evt.pass_rate}%`
          );
          setStatus("done");
          updateTask(currentTaskIdRef.current, {
            status: "done",
            total: evt.total_cases,
            passed: evt.passed,
            failed: evt.failed,
            passRate: evt.pass_rate,
            reportFile: evt.report_file,
            markdown: evt.markdown || "",
            finishedAt: new Date().toLocaleString(),
          });
          break;
        case "error":
          setStageMsg(evt.message || "执行失败");
          setStatus("error");
          updateTask(currentTaskIdRef.current, {
            status: "failed",
            error: evt.message || "执行失败",
            finishedAt: new Date().toLocaleString(),
          });
          break;
        default:
          break;
      }
    });
    return close;
  }, []);

  useEffect(() => {
    if (status !== "running") return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (resultsRef.current) {
      resultsRef.current.scrollTop = resultsRef.current.scrollHeight;
    }
  }, [results]);

  useEffect(() => {
    if (!showReport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowReport(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showReport]);

  const checkHealth = async () => {
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
  };
  useEffect(() => {
    checkHealth();
  }, []);

  // 恢复上次状态
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ws_state");
      if (!raw) return;
      const ws = JSON.parse(raw);
      if (ws.view) setView(ws.view);
      if (ws.activeTaskId) {
        const t = tasks.find((x: TestTask) => x.id === ws.activeTaskId);
        if (t) {
          setActiveTaskId(t.id);
          setMarkdownReport(t.markdown || "");
          setReportFile(t.reportFile || "");
          setTotal(t.total || 0);
        }
      }
      if (ws.activeConfigId) {
        const c = configs.find((x: TestConfig) => x.id === ws.activeConfigId);
        if (c) {
          setActiveConfigId(c.id);
          loadConfig(c);
        }
      } else if (configs[0]) {
        setActiveConfigId(configs[0].id);
        loadConfig(configs[0]);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      persist("ws_state", {
        activeTaskId,
        activeConfigId,
        view,
        savedAt: new Date().toISOString(),
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeTaskId, activeConfigId, view]);

  const handleSendFollowUp = async () => {
    if (!chatInput.trim() || status === "running" || !activeTaskId) return;
    const instruction = chatInput;
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", content: instruction }]);
    const rid = beginRun();
    try {
      const data = await chatRefine(
        instruction,
        {
          api_key: dsKey.trim() || undefined,
          model: dsModel.trim() || undefined,
          base_url: dsBase.trim() || undefined,
        },
        rid
      );
      updateTask(currentTaskIdRef.current, {
        status: "done",
        total: data.total_cases,
        passed: data.passed,
        failed: data.failed,
        passRate: data.pass_rate,
        reportFile: data.report_file,
        markdown: data.markdown_report,
        finishedAt: new Date().toLocaleString(),
      });
      if (data.agent_reply) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.agent_reply as string },
        ]);
      }
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setStageMsg(friendlyError(e));
    }
  };

  const handleDownloadMd = () => {
    if (!markdownReport) return;
    const blob = new Blob([markdownReport], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeTask?.config.projectName || "报告"}-反例测试报告.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const readFileInto = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (v: string) => void
  ) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setter(String(reader.result || ""));
      setImportName(file.name);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const navItems: { key: View; label: string; icon: React.ReactNode }[] = [
    { key: "run", label: "任务", icon: <ListTodo className="w-5 h-5" /> },
    {
      key: "config",
      label: "配置",
      icon: <SlidersHorizontal className="w-5 h-5" />,
    },
    { key: "settings", label: "设置", icon: <Settings className="w-5 h-5" /> },
  ];

  const runningCount = tasks.filter((t) => t.status === "running").length;

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 font-sans">
      {/* 一级导航 */}
      <nav className="w-[76px] shrink-0 bg-white border-r border-slate-200 flex flex-col items-center py-3 gap-1">
        <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold mb-2">
          BLS
        </div>
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => setView(item.key)}
            className={`w-16 py-2 rounded-lg flex flex-col items-center gap-1 text-[11px] ${
              view === item.key
                ? "bg-indigo-50 text-indigo-600"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      {/* 二级侧栏：任务 / 配置 */}
      {view === "run" && (
        <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="px-3 py-3 border-b border-slate-200 space-y-2">
            {creatingTask ? (
              <div className="space-y-1.5">
                <select
                  value={newTaskConfigId}
                  onChange={(e) => setNewTaskConfigId(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs"
                >
                  <option value="">选择配置…</option>
                  {configs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-1.5">
                  <button
                    disabled={!newTaskConfigId}
                    onClick={() => createTaskFromConfig(newTaskConfigId, true)}
                    className="flex-1 px-2 py-1 rounded bg-indigo-600 text-white text-xs disabled:opacity-40"
                  >
                    创建并执行
                  </button>
                  <button
                    onClick={() => setCreatingTask(false)}
                    className="px-2 py-1 rounded border border-slate-300 text-xs text-slate-500"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setCreatingTask(true);
                  setNewTaskConfigId(activeConfigId || configs[0]?.id || "");
                }}
                className="w-full px-3 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-600 text-xs flex items-center justify-center gap-1 hover:bg-indigo-100"
              >
                <Plus className="w-3.5 h-3.5" /> 新建任务
              </button>
            )}
            {runningCount > 0 && (
              <div className="text-[10px] text-amber-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {runningCount} 个任务运行中
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {tasks.length === 0 && (
              <div className="px-3 py-4 text-[11px] text-slate-400">
                还没有任务，点上方「新建任务」
              </div>
            )}
            {[...tasks]
              .sort((a, b) => statusWeight(a.status) - statusWeight(b.status))
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTask(t)}
                  className={`w-full text-left px-3 py-2 border-l-2 ${
                    t.id === activeTaskId
                      ? "border-indigo-500 bg-indigo-50/60"
                      : "border-transparent hover:bg-slate-50"
                  }`}
                >
                  <div className="text-[12px] text-slate-800 truncate">{t.name}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <TaskBadge task={t} />
                    <span className="text-[10px] text-slate-400 truncate">
                      {t.createdAt}
                    </span>
                  </div>
                </button>
              ))}
          </div>
        </aside>
      )}

      {view === "config" && (
        <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="px-3 py-3 border-b border-slate-200">
            <button
              onClick={createConfig}
              className="w-full px-3 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-600 text-xs flex items-center justify-center gap-1 hover:bg-indigo-100"
            >
              <Plus className="w-3.5 h-3.5" /> 新建配置
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {configs.length === 0 && (
              <div className="px-3 py-4 text-[11px] text-slate-400">
                还没有配置，点上方「新建配置」
              </div>
            )}
            {configs.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  saveActiveConfig();
                  setActiveConfigId(c.id);
                  loadConfig(c);
                }}
                className={`w-full text-left px-3 py-2 border-l-2 ${
                  c.id === activeConfigId
                    ? "border-indigo-500 bg-indigo-50/60"
                    : "border-transparent hover:bg-slate-50"
                }`}
              >
                <div className="text-[12px] text-slate-800 truncate">{c.name}</div>
                <div className="text-[10px] text-slate-400 truncate font-mono">
                  {c.baseUrl || "未配置地址"}
                </div>
              </button>
            ))}
          </div>
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {apiStatus === "down" && (
          <div className="px-5 py-2 bg-rose-50 border-b border-rose-200 text-[12px] text-rose-700 flex items-center justify-between gap-3">
            <span className="truncate">
              无法连接后端 <code className="font-mono">{API_BASE}</code>：请先启动后端
            </span>
            <button
              onClick={checkHealth}
              className="shrink-0 px-2.5 py-1 rounded border border-rose-300 bg-white hover:bg-rose-100"
            >
              重试
            </button>
          </div>
        )}

        {view === "run" && (
          <RunView
            activeTask={activeTask}
            status={status}
            stageMsg={stageMsg}
            elapsed={elapsed}
            total={total}
            cases={cases}
            results={results}
            passed={passed}
            failed={failed}
            markdownReport={markdownReport}
            reportFile={reportFile}
            showReport={showReport}
            chatInput={chatInput}
            resultsRef={resultsRef}
            onOpenReport={() => setShowReport(true)}
            onCloseReport={() => setShowReport(false)}
            onDownload={handleDownloadMd}
            onChatChange={setChatInput}
            onSendChat={handleSendFollowUp}
            configs={configs}
            configId={activeTask?.configId || activeConfigId}
            onChangeConfig={(id) => {
              setActiveConfigId(id);
              const cfg = configs.find((c) => c.id === id);
              if (cfg) loadConfig(cfg);
            }}
            onRunSelected={() => {
              if (!activeConfigId) return;
              saveActiveConfig(activeConfigId);
              const cfg = configs.find((c) => c.id === activeConfigId);
              if (cfg) createTaskFromConfig(cfg.id, true);
            }}
          />
        )}

        {view === "config" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {activeConfig ? activeConfig.name : "尚未选择配置"}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    配置可被多个任务复用；新建任务时选择它
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      saveActiveConfig();
                      setStageMsg("已保存配置");
                    }}
                    disabled={!activeConfigId}
                    className="px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    保存配置
                  </button>
                  <button
                    onClick={() => {
                      if (!activeConfigId) return;
                      saveActiveConfig();
                      createTaskFromConfig(activeConfigId, true);
                    }}
                    disabled={!activeConfigId || status === "running"}
                    className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Play className="w-4 h-4" /> 用此配置执行
                  </button>
                  <button
                    onClick={() => activeConfigId && deleteConfig(activeConfigId)}
                    disabled={!activeConfigId}
                    className="px-2 py-1.5 rounded-md border border-rose-200 text-rose-600 text-sm hover:bg-rose-50 disabled:opacity-40"
                    title="删除配置"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="配置名称 / 项目名">
                    <input
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="API Base URL">
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className={`${inputCls} font-mono`}
                    />
                  </Field>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-slate-500 flex items-center gap-1">
                      <Braces className="w-3.5 h-3.5" /> 接口定义 / API JSON
                    </label>
                    <div className="flex items-center gap-2">
                      {importName && (
                        <span className="text-[10px] text-slate-400">{importName}</span>
                      )}
                      <button
                        onClick={() => apiFileRef.current?.click()}
                        className="text-[11px] text-indigo-600 border border-indigo-200 bg-indigo-50 px-2 py-0.5 rounded flex items-center gap-1"
                      >
                        <Upload className="w-3 h-3" /> 导入文件
                      </button>
                      <input
                        ref={apiFileRef}
                        type="file"
                        accept=".json,.yaml,.yml,.md,.txt"
                        onChange={(e) => readFileInto(e, setApiSpec)}
                        className="hidden"
                      />
                    </div>
                  </div>
                  <textarea
                    value={apiSpec}
                    onChange={(e) => setApiSpec(e.target.value)}
                    className={`${inputCls} h-56 font-mono text-xs`}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-slate-500">产品需求文档（PRD）</label>
                    <button
                      onClick={() => prdFileRef.current?.click()}
                      className="text-[11px] text-slate-600 border border-slate-200 bg-slate-50 px-2 py-0.5 rounded flex items-center gap-1"
                    >
                      <Upload className="w-3 h-3" /> 导入
                    </button>
                    <input
                      ref={prdFileRef}
                      type="file"
                      accept=".md,.txt,.json,.yaml,.yml"
                      onChange={(e) => readFileInto(e, setPrdText)}
                      className="hidden"
                    />
                  </div>
                  <textarea
                    value={prdText}
                    onChange={(e) => setPrdText(e.target.value)}
                    className={`${inputCls} h-40 text-xs`}
                  />
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-medium">认证方式</h3>
                <div className="flex flex-wrap gap-2">
                  <ModeButton
                    active={authMode === "none"}
                    onClick={() => setAuthMode("none")}
                    label="不认证"
                  />
                  <ModeButton
                    active={authMode === "cookie"}
                    onClick={() => setAuthMode("cookie")}
                    label="注入 Cookie"
                    icon={<Cookie className="w-3.5 h-3.5" />}
                  />
                  <ModeButton
                    active={authMode === "login"}
                    onClick={() => setAuthMode("login")}
                    label="登录前置"
                    icon={<LogIn className="w-3.5 h-3.5" />}
                  />
                </div>

                {authMode === "cookie" && (
                  <Field label="Cookie（填了就跳过登录）">
                    <textarea
                      value={cookie}
                      onChange={(e) => setCookie(e.target.value)}
                      placeholder="JSESSIONID=xxxxxx; other=yyy"
                      className={`${inputCls} h-20 font-mono text-xs`}
                    />
                  </Field>
                )}

                {authMode === "login" && (
                  <div className="space-y-3">
                    <Field label="CPS27 param">
                      <input
                        value={login.param}
                        onChange={(e) => setLogin({ ...login, param: e.target.value })}
                        placeholder="CPS27EFORM_..."
                        className={`${inputCls} font-mono text-xs`}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="userPhone *">
                        <input
                          value={login.userPhone}
                          onChange={(e) =>
                            setLogin({ ...login, userPhone: e.target.value })
                          }
                          className={inputCls}
                        />
                      </Field>
                      <Field label="exhibitionId">
                        <input
                          value={login.exhibitionId}
                          onChange={(e) =>
                            setLogin({ ...login, exhibitionId: e.target.value })
                          }
                          className={`${inputCls} font-mono text-xs`}
                        />
                      </Field>
                      <Field label="boothNo（可留空）">
                        <input
                          value={login.boothNo}
                          onChange={(e) =>
                            setLogin({ ...login, boothNo: e.target.value })
                          }
                          className={inputCls}
                        />
                      </Field>
                      <Field label="companyId（可留空）">
                        <input
                          value={login.companyId}
                          onChange={(e) =>
                            setLogin({ ...login, companyId: e.target.value })
                          }
                          className={inputCls}
                        />
                      </Field>
                      <Field label="agency-id">
                        <input
                          value={login.agencyId}
                          onChange={(e) =>
                            setLogin({ ...login, agencyId: e.target.value })
                          }
                          className={inputCls}
                        />
                      </Field>
                      <Field label="tenant-id">
                        <input
                          value={login.tenantId}
                          onChange={(e) =>
                            setLogin({ ...login, tenantId: e.target.value })
                          }
                          className={inputCls}
                        />
                      </Field>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {view === "settings" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">设置</h2>
              <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-medium flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-amber-500" /> DeepSeek
                </h3>
                <Field label="API Key">
                  <input
                    type="password"
                    value={dsKey}
                    onChange={(e) => setDsKey(e.target.value)}
                    placeholder="sk-..."
                    className={`${inputCls} font-mono`}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="模型">
                    <select
                      value={dsModel}
                      onChange={(e) => setDsModel(e.target.value)}
                      className={inputCls}
                    >
                      <option value="deepseek-chat">deepseek-chat</option>
                      <option value="deepseek-reasoner">deepseek-reasoner</option>
                    </select>
                  </Field>
                  <Field label="Base URL">
                    <input
                      value={dsBase}
                      onChange={(e) => setDsBase(e.target.value)}
                      className={`${inputCls} font-mono`}
                    />
                  </Field>
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
                <h3 className="text-sm font-medium">本地数据</h3>
                <p className="text-[11px] text-slate-400">
                  配置、任务与报告保存在本机浏览器，最多 30 个任务 / 50 个配置。
                </p>
                <button
                  onClick={() => {
                    setTasks([]);
                    setConfigs([]);
                    setHistory([]);
                    setActiveTaskId("");
                    setActiveConfigId("");
                    ["tasks", "configs", "run_history", "ws_state"].forEach((k) =>
                      localStorage.removeItem(k)
                    );
                  }}
                  className="px-3 py-1.5 rounded-md border border-rose-200 text-rose-600 text-sm hover:bg-rose-50"
                >
                  清空本机数据
                </button>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- 子组件 ----------------
const inputCls =
  "w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400";

function statusWeight(s: TestTask["status"]) {
  return s === "running" ? 0 : s === "pending" ? 1 : s === "failed" ? 2 : 3;
}

function TaskBadge({ task }: { task: TestTask }) {
  if (task.status === "running") {
    return (
      <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 text-[10px] flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        运行中
      </span>
    );
  }
  if (task.status === "done") {
    return (
      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 text-[10px]">
        已完成{task.passRate ? ` ${task.passRate}%` : ""}
      </span>
    );
  }
  if (task.status === "failed") {
    return (
      <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-200 text-[10px]">
        失败
      </span>
    );
  }
  return (
    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 text-[10px]">
      待执行
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md border text-xs flex items-center gap-1.5 ${
        active
          ? "border-indigo-300 bg-indigo-50 text-indigo-700"
          : "border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function RunView({
  activeTask,
  status,
  stageMsg,
  elapsed,
  total,
  cases,
  results,
  passed,
  failed,
  markdownReport,
  reportFile,
  showReport,
  chatInput,
  resultsRef,
  onOpenReport,
  onCloseReport,
  onDownload,
  onChatChange,
  onSendChat,
  configs,
  configId,
  onChangeConfig,
  onRunSelected,
}: {
  activeTask?: TestTask;
  status: RunStatus;
  stageMsg: string;
  elapsed: number;
  total: number;
  cases: NegativeTestCase[];
  results: CaseExecutionResult[];
  passed: number;
  failed: number;
  markdownReport: string;
  reportFile: string;
  showReport: boolean;
  chatInput: string;
  resultsRef: React.RefObject<HTMLDivElement>;
  onOpenReport: () => void;
  onCloseReport: () => void;
  onDownload: () => void;
  onChatChange: (v: string) => void;
  onSendChat: () => void;
  configs: TestConfig[];
  configId: string;
  onChangeConfig: (id: string) => void;
  onRunSelected: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-5 py-3 border-b border-slate-200 bg-white flex items-center justify-between gap-4">
        <div className="min-w-0 flex items-center gap-3">
          <StatusDot status={status} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900 truncate">
              {activeTask ? activeTask.name : statusText(status, stageMsg)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <StatTag label="耗时" value={`${elapsed}s`} tone="slate">
                <Clock className="w-3 h-3" />
              </StatTag>
              <StatTag label="反例" value={total || cases.length} tone="indigo" />
              <StatTag
                label="已完成"
                value={`${results.length}${total ? `/${total}` : ""}`}
                tone="amber"
              />
              <StatTag label="通过" value={passed} tone="emerald" />
              <StatTag label="失败" value={failed} tone="rose" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={configId}
            onChange={(e) => onChangeConfig(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-xs max-w-[15rem]"
            title="选择要执行的配置"
          >
            <option value="">选择配置…</option>
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={onRunSelected}
            disabled={!configId || status === "running"}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" /> 运行
          </button>
          <button
            onClick={onOpenReport}
            disabled={!markdownReport}
            className="bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-slate-300"
          >
            <FileText className="w-3.5 h-3.5" /> MD 报告
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto p-5 space-y-4">
          <section>
            <SectionTitle
              title="① 生成的反例用例"
              count={cases.length}
              hint={
                cases.length === 0
                  ? configs.length === 0
                    ? "还没有配置，请先到「配置」页新建"
                    : "在上方选择配置后点「运行」"
                  : undefined
              }
            />
            {cases.length === 0 ? (
              <Skeleton lines={3} />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {cases.map((c, idx) => (
                  <div
                    key={`${c.case_id || idx}`}
                    className="bg-white border border-slate-200 rounded-md px-3 py-2 text-xs flex items-start gap-2"
                  >
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] ${
                        CATEGORY_STYLE[c.category] ||
                        "bg-slate-100 text-slate-600 border-slate-300"
                      }`}
                    >
                      {c.category || "CASE"}
                    </span>
                    <div className="min-w-0">
                      <div className="text-slate-800 truncate">{c.title}</div>
                      <div className="text-[11px] text-slate-400 font-mono truncate">
                        {c.method} {c.path}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle title="② 测试执行结果" count={results.length} />
            <div
              ref={resultsRef}
              className="bg-white border border-slate-200 rounded-lg max-h-[46vh] overflow-y-auto divide-y divide-slate-100"
            >
              {results.length === 0 ? (
                <div className="p-4 text-xs text-slate-400">
                  {status === "running"
                    ? "等待首个反例返回…"
                    : "执行结果会在这里实时出现。"}
                </div>
              ) : (
                results.map((r, idx) => (
                  <div
                    key={`${r.case_id}-${idx}`}
                    className="px-3 py-2 text-xs flex items-center gap-3"
                  >
                    {r.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                    )}
                    <span className="font-mono text-slate-400 w-14 shrink-0">
                      {r.case_id || "-"}
                    </span>
                    <span className="text-slate-800 min-w-0 flex-1 truncate">
                      {r.title}
                    </span>
                    <span className="font-mono text-slate-500 shrink-0">
                      {r.actual_status || "ERR"}
                    </span>
                    <span className="text-slate-400 w-14 text-right shrink-0">
                      {r.duration_ms}ms
                    </span>
                    {!r.passed && (
                      <span
                        className="text-[10px] text-rose-500 max-w-[16rem] truncate"
                        title={r.failure_reason || ""}
                      >
                        {r.failure_reason}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {showReport && (
          <div className="absolute inset-0 bg-white z-20 flex flex-col">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  Markdown 报告预览
                </div>
                {reportFile && (
                  <div className="text-[11px] text-slate-400 font-mono truncate">
                    {reportFile}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={onDownload}
                  disabled={!markdownReport}
                  className="bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-slate-300"
                >
                  <FileDown className="w-3.5 h-3.5" /> 导出 .MD
                </button>
                <button
                  onClick={() =>
                    window.open(`${API_BASE}/api/pipeline/report/download`, "_blank")
                  }
                  disabled={!reportFile}
                  className="bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-slate-300"
                >
                  <FileDown className="w-3.5 h-3.5" /> 报告文件
                </button>
                <button
                  onClick={onCloseReport}
                  className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" /> 关闭
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 prose prose-slate max-w-none text-sm">
              <ReactMarkdown>{markdownReport}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-white p-3 flex items-center gap-2">
        <span className="text-[11px] text-slate-400 shrink-0">追问</span>
        <input
          value={chatInput}
          onChange={(e) => onChatChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSendChat()}
          placeholder="如：这些接口需要先登录再测试…"
          className="flex-1 bg-white border border-slate-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
        <button
          onClick={onSendChat}
          disabled={status === "running"}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 px-3 py-2 rounded-md text-white"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

type TagTone = "slate" | "indigo" | "amber" | "emerald" | "rose";

const TAG_TONE: Record<TagTone, string> = {
  slate: "bg-white text-slate-500 border-slate-200",
  indigo: "bg-indigo-50 text-indigo-600 border-indigo-200",
  amber: "bg-amber-50 text-amber-600 border-amber-200",
  emerald: "bg-emerald-50 text-emerald-600 border-emerald-200",
  rose: "bg-rose-50 text-rose-600 border-rose-200",
};

function StatTag({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: React.ReactNode;
  tone: TagTone;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] ${TAG_TONE[tone]}`}
    >
      {children}
      <span className="opacity-60">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function friendlyError(e: unknown) {
  const msg = (e as Error)?.message || String(e);
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return `无法连接后端（${API_BASE}），请确认已运行 cargo run 且 8080 端口未被占用。`;
  }
  return msg;
}

function StatusDot({ status }: { status: RunStatus }) {
  const color =
    status === "running"
      ? "bg-amber-400 animate-pulse"
      : status === "done"
      ? "bg-emerald-500"
      : status === "error"
      ? "bg-rose-500"
      : "bg-slate-300";
  return <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />;
}

function statusText(status: RunStatus, stageMsg: string) {
  if (status === "running") return stageMsg || "运行中…";
  if (status === "done") return stageMsg || "执行完成";
  if (status === "error") return stageMsg || "执行失败";
  return "就绪：在左侧选择任务";
}

function SectionTitle({
  title,
  count,
  hint,
}: {
  title: string;
  count: number;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="text-sm font-medium text-slate-800">
        {title}
        <span className="ml-1.5 text-xs text-slate-400">{count}</span>
      </div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-8 bg-slate-100 rounded-md animate-pulse"
          style={{ width: `${92 - i * 8}%` }}
        />
      ))}
    </div>
  );
}
