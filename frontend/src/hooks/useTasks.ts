import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CaseExecutionResult,
  NegativeTestCase,
  PipelineEvent,
  RunHistoryItem,
  TestConfig,
  TestPipeline,
  TestTask,
} from "../types/pipeline";
import type { DeepSeekSettings, TaskRun } from "../types/ui";
import { EMPTY_RUN } from "../types/ui";
import { getStore, putStore } from "../services/api";
import {
  appendCases,
  executePipeline,
  initAndRun,
  subscribeEvents,
} from "../services/api";
import { buildAuth } from "../lib/auth";
import { friendlyError } from "../lib/errors";

/** 落库前剔除凭证，避免 token/Cookie 进入任务快照与 AI/报告（F05） */
function sanitizePipeline(p: TestPipeline): TestPipeline {
  const safeHeaders = Object.fromEntries(
    Object.entries(p.global_headers || {}).filter(
      ([k]) => !/^(authorization|cookie)$/i.test(k.trim())
    )
  );
  return { ...p, global_headers: safeHeaders };
}

function readTasks(): TestTask[] {
  try {
    const raw = localStorage.getItem("tasks");
    if (raw) return JSON.parse(raw) as TestTask[];
    // 老数据迁移：历史记录 -> 已完成任务
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
        authMode: "none" as const,
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
}

function persistTasks(next: TestTask[]) {
  try {
    localStorage.setItem("tasks", JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** 任务 + 每个任务独立的运行态（支持多任务并行） */
export function useTasks() {
  const [tasks, setTasks] = useState<TestTask[]>(readTasks);
  const [runs, setRuns] = useState<Record<string, TaskRun>>({});
  const [activeTaskId, setActiveTaskId] = useState("");

  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  // 本地数据库（后端 SQLite）：启动时以数据库为准（含反例与报告正文）
  const hydrated = useRef(false);
  useEffect(() => {
    (async () => {
      const remote = await getStore<TestTask[]>("tasks");
      if (Array.isArray(remote) && remote.length > 0) {
        setTasks(remote);
        persistTasks(remote);
      } else if (tasks.length > 0) {
        void putStore("tasks", tasks).catch(() => {});
      }
      hydrated.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const timer = window.setTimeout(() => {
      void putStore("tasks", tasks).catch(() => {});
    }, 600);
    return () => window.clearTimeout(timer);
  }, [tasks]);

  /** 立即落库（手动保存用） */
  const flush = async (): Promise<boolean> => {
    try {
      await putStore("tasks", tasksRef.current);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  };

  // runId -> taskId，SSE 事件按任务分发
  const runOwner = useRef<Record<string, string>>({});
  // 正在执行的任务集合（防止重复点击）
  const runningTasks = useRef<Set<string>>(new Set());

  const saveTasks = useCallback((next: TestTask[]) => {
    setTasks(next);
    persistTasks(next);
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<TestTask>) => {
    if (!id) return;
    setTasks((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
      persistTasks(next);
      return next;
    });
  }, []);

  /** 删除任务（同时清理它的运行态） */
  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => {
      const next = prev.filter((t) => t.id !== id);
      persistTasks(next);
      return next;
    });
    setRuns((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    runningTasks.current.delete(id);
    setActiveTaskId((prev) => (prev === id ? "" : prev));
  }, []);

  const patchRun = useCallback((taskId: string, patch: Partial<TaskRun>) => {
    if (!taskId) return;
    setRuns((prev) => ({
      ...prev,
      [taskId]: { ...(prev[taskId] || EMPTY_RUN), ...patch },
    }));
  }, []);

  // SSE 事件分发
  useEffect(() => {
    const close = subscribeEvents((data) => {
      let evt: PipelineEvent;
      try {
        evt = JSON.parse(data) as PipelineEvent;
      } catch {
        return;
      }
      const taskId = evt.run_id ? runOwner.current[evt.run_id] : undefined;
      if (!taskId) return;

      switch (evt.type) {
        case "stage":
          patchRun(taskId, { stageMsg: evt.message || evt.stage || "" });
          break;
        case "cases": {
          const list = (evt.payload as NegativeTestCase[]) || [];
          setRuns((prev) => {
            const cur = prev[taskId] || EMPTY_RUN;
            let merged: NegativeTestCase[];
            if (evt.partial) {
              const map = new Map(cur.cases.map((c) => [c.case_id, c]));
              list.forEach((c) => map.set(c.case_id, c));
              merged = Array.from(map.values());
            } else {
              merged = list;
            }
            return {
              ...prev,
              [taskId]: {
                ...cur,
                cases: merged,
                total: evt.partial
                  ? Math.max(cur.total, evt.total_cases || merged.length)
                  : merged.length,
              },
            };
          });
          break;
        }
        case "result": {
          const item = evt.payload as unknown as CaseExecutionResult;
          setRuns((prev) => {
            const cur = prev[taskId] || EMPTY_RUN;
            return {
              ...prev,
              [taskId]: {
                ...cur,
                results: [...cur.results, item],
                total: Math.max(cur.total, cur.results.length + 1),
              },
            };
          });
          break;
        }
        case "report":
          patchRun(taskId, {
            status: "done",
            markdown: evt.markdown || "",
            reportFile: evt.report_file || "",
            total: evt.total_cases || 0,
            stageMsg: `完成：通过 ${evt.passed} / 失败 ${evt.failed} / 通过率 ${evt.pass_rate}%`,
          });
          updateTask(taskId, {
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
          patchRun(taskId, {
            status: "error",
            stageMsg: evt.message || "执行失败",
          });
          updateTask(taskId, {
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
  }, [patchRun, updateTask]);

  /** 执行某个任务（task 可传入以避免状态延迟） */
  const runTask = useCallback(
    async (taskId: string, deepseek: DeepSeekSettings, taskOverride?: TestTask) => {
      const task =
        taskOverride || tasksRef.current.find((t) => t.id === taskId);
      if (!task) return;
      if (runningTasks.current.has(taskId)) return;
      runningTasks.current.add(taskId);

      const cfg = task.config;
      const existing = task.cases || [];
      const reuse = existing.length > 0;
      const rid = `${taskId}-${Date.now()}`;
      runOwner.current[rid] = taskId;
      setActiveTaskId(taskId);
      patchRun(taskId, {
        runId: rid,
        status: "running",
        stageMsg: reuse ? "复用任务里的反例执行…" : "提交中…",
        cases: existing,
        results: [],
        total: existing.length,
        markdown: "",
        reportFile: "",
        startedAt: Date.now(),
      });
      updateTask(taskId, {
        status: "running",
        total: 0,
        passed: 0,
        failed: 0,
        passRate: undefined,
        markdown: "",
        reportFile: "",
        error: undefined,
      });

      try {
        // 已有反例 → 只执行，不再调用 AI；否则首轮生成
        // 复用执行要带上前置步骤/需求快照，否则报告里需求矩阵与登录链路会缺失
        const saved = task.pipeline;
        const data = reuse
          ? await executePipeline({
              pipeline: {
                project_name: cfg.projectName,
                base_url: cfg.baseUrl,
                global_headers: {
                  "Content-Type": "application/json",
                  ...(saved?.global_headers || {}),
                  ...(cfg.headers || {}),
                },
                pre_steps: saved?.pre_steps || [],
                requirements: saved?.requirements || [],
                negative_cases: existing,
              },
              auth: buildAuth(cfg),
              run_id: rid,
            })
          : await initAndRun({
              project_name: cfg.projectName,
              base_url: cfg.baseUrl,
              api_spec: cfg.apiSpec,
              prd_content: cfg.prdText,
              deepseek,
              auth: buildAuth(cfg),
              extra_headers: cfg.headers,
              run_id: rid,
            });

        const finalCases = data.pipeline?.negative_cases?.length
          ? data.pipeline.negative_cases
          : existing;

        // 断流补偿：HTTP 返回的 results 是事实来源，SSE 只负责增量
        const finalResults = Array.isArray(data.results) && data.results.length > 0
          ? data.results
          : runsRef.current[taskId]?.results || [];

        patchRun(taskId, {
          status: "done",
          cases: finalCases,
          results: finalResults,
          markdown: data.markdown_report,
          reportFile: data.report_file || "",
          total: data.total_cases,
          durationMs: Date.now() - (runsRef.current[taskId]?.startedAt || Date.now()),
        });
        updateTask(taskId, {
          cases: finalCases,
          pipeline: sanitizePipeline(data.pipeline),
          status: "done",
          total: data.total_cases,
          passed: data.passed,
          failed: data.failed,
          passRate: data.pass_rate,
          reportFile: data.report_file,
          markdown: data.markdown_report,
          finishedAt: new Date().toLocaleString(),
        });
      } catch (e) {
        patchRun(taskId, { status: "error", stageMsg: friendlyError(e) });
        updateTask(taskId, {
          status: "failed",
          error: friendlyError(e),
          finishedAt: new Date().toLocaleString(),
        });
      } finally {
        runningTasks.current.delete(taskId);
      }
    },
    [patchRun, updateTask]
  );

  /** 用自然语言追加反例，追加完立即复用全部反例执行 */
  const appendCasesToTask = useCallback(
    async (
      taskId: string,
      instruction: string,
      deepseek: DeepSeekSettings
    ): Promise<{ added: number; error?: string; skippedRun?: boolean }> => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task) return { added: 0, error: "找不到当前任务" };
      if (!instruction.trim()) return { added: 0, error: "追加描述为空" };

      const cfg = task.config;
      if (!cfg.apiSpec?.trim() && !cfg.prdText?.trim()) {
        return {
          added: 0,
          error: "该任务没有接口定义（API JSON）或 PRD，无法生成新反例。请先在「配置」里补充。",
        };
      }
      if (!cfg.baseUrl?.trim()) {
        return { added: 0, error: "该任务没有配置 Base URL，无法执行。" };
      }

      patchRun(taskId, { stageMsg: "正在追加反例…" });
      try {
        const res = await appendCases({
          instruction: instruction.trim(),
          api_spec: cfg.apiSpec,
          prd_content: cfg.prdText,
          existing_cases: task.cases || [],
          deepseek,
        });
        if (!res.added || res.added.length === 0) {
          return {
            added: 0,
            error:
              "DeepSeek 没有返回新增用例（可能描述过于笼统，或与已有用例重复）。换个更具体的场景试试。",
          };
        }
        const merged = [...(task.cases || []), ...res.added];
        updateTask(taskId, { cases: merged });
        patchRun(taskId, { cases: merged });
        // 当前有运行在进行：先只追加，避免撞上单运行闸门
        if (runningTasks.current.has(taskId)) {
          return { added: res.added.length, skippedRun: true };
        }
        // 追加后重跑（走 execute，不再让 AI 重新生成）
        await runTask(taskId, deepseek, { ...task, cases: merged });
        return { added: res.added.length };
      } catch (e) {
        const msg = friendlyError(e);
        patchRun(taskId, { status: "error", stageMsg: msg });
        updateTask(taskId, { error: msg });
        return { added: 0, error: msg };
      }
    },
    [patchRun, runTask, updateTask]
  );

  /** 用显式快照创建任务（弹窗里可改名/改配置） */
  const createTaskSnapshot = useCallback(
    (
      name: string,
      config: TestTask["config"],
      opts: { configId?: string; autoRun: boolean; deepseek: DeepSeekSettings }
    ): TestTask => {
      const task: TestTask = {
        id: `task-${Date.now()}`,
        name: name.trim() || `${config.projectName || "未命名"} · ${new Date().toLocaleTimeString()}`,
        status: "pending",
        createdAt: new Date().toLocaleString(),
        configId: opts.configId,
        config,
      };
      setTasks((prev) => {
        const next = [task, ...prev].slice(0, 30);
        persistTasks(next);
        return next;
      });
      setActiveTaskId(task.id);
      if (opts.autoRun) void runTask(task.id, opts.deepseek, task);
      return task;
    },
    [runTask]
  );

  /** 用某个配置新建任务；autoRun 为 true 时立即执行 */
  const createTaskFromConfig = useCallback(
    (
      cfg: TestConfig,
      autoRun: boolean,
      deepseek: DeepSeekSettings
    ): TestTask => {
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
          headers: cfg.headers || {},
        },
      };
      setTasks((prev) => {
        const next = [task, ...prev].slice(0, 30);
        persistTasks(next);
        return next;
      });
      setActiveTaskId(task.id);
      if (autoRun) {
        void runTask(task.id, deepseek, task);
      }
      return task;
    },
    [runTask]
  );

  return {
    tasks,
    runs,
    activeTaskId,
    setActiveTaskId,
    saveTasks,
    updateTask,
    patchRun,
    runTask,
    appendCasesToTask,
    createTaskFromConfig,
    createTaskSnapshot,
    deleteTask,
    flush,
  };
}
