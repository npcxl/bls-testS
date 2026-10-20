import { useState } from "react";
import { Cookie, Lock, Plus, Unlock } from "lucide-react";
import type { TestConfig, TestTask } from "../types/pipeline";
import { authSummary, parseCookie, taskStatusMeta } from "../lib/labels";

export function TaskSidebar({
  tasks,
  configs,
  activeTaskId,
  defaultConfigId,
  onSelect,
  onCreate,
  onOpenAuth,
}: {
  tasks: TestTask[];
  configs: TestConfig[];
  activeTaskId: string;
  defaultConfigId: string;
  onSelect: (id: string) => void;
  onCreate: (configId: string) => void;
  onOpenAuth: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [configId, setConfigId] = useState("");

  const activeTask = tasks.find((t) => t.id === activeTaskId) || tasks[0];
  const cookieMap = parseCookie(activeTask?.config?.cookie);

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0">
      <div className="p-3.5 border-b border-slate-100">
        {creating ? (
          <div className="space-y-1.5">
            <select
              value={configId}
              onChange={(e) => setConfigId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
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
                disabled={!configId}
                onClick={() => {
                  onCreate(configId);
                  setCreating(false);
                }}
                className="flex-1 py-1.5 rounded-lg bg-[#1a1a1a] hover:bg-black text-white text-xs font-medium disabled:opacity-40"
              >
                创建并执行
              </button>
              <button
                onClick={() => setCreating(false)}
                className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              setCreating(true);
              setConfigId(defaultConfigId || configs[0]?.id || "");
            }}
            className="w-full py-2 px-3 rounded-lg bg-[#1a1a1a] hover:bg-black text-white font-medium text-xs flex items-center justify-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" /> 新建反例测试任务
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        <div className="px-1.5 py-1 flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          <span>历史测试会话 ({tasks.length})</span>
          <span>状态</span>
        </div>

        {tasks.length === 0 && (
          <div className="px-2 py-4 text-[11px] text-slate-400">
            还没有任务，点上方按钮新建
          </div>
        )}

        {tasks.map((task) => {
          const active = task.id === activeTaskId;
          const total = task.total || 0;
          const pass = task.passed || 0;
          const fail = task.failed || 0;
          const status = taskStatusMeta(task.status);
          const auth = authSummary(task.config);
          const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;
          const failRate = total > 0 ? Math.round((fail / total) * 100) : 0;

          return (
            <div
              key={task.id}
              onClick={() => onSelect(task.id)}
              className={`p-3 rounded-xl border transition-all cursor-pointer ${
                active
                  ? "bg-slate-50 border-[#1a1a1a]/30 shadow-sm ring-1 ring-[#1a1a1a]/10"
                  : "bg-white border-slate-200/70 hover:border-slate-300 hover:bg-slate-50/60"
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-xs font-semibold text-slate-800 truncate">
                  {task.name}
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
                <span className="font-mono text-[10px]">{task.createdAt}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${status.cls}`}>
                  {status.text}
                </span>
              </div>

              <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-slate-100 text-[10px]">
                <span className="flex items-center gap-1 text-slate-600 truncate">
                  {auth.hasCookie ? (
                    <Lock className="w-3 h-3 text-emerald-600 shrink-0" />
                  ) : (
                    <Unlock className="w-3 h-3 text-amber-500 shrink-0" />
                  )}
                  <span className="truncate">{auth.label}</span>
                </span>
                <span className="font-mono text-slate-500 shrink-0">
                  <b className="text-emerald-600">{pass}</b>/
                  <b className="text-rose-600">{fail}</b>/{total}
                </span>
              </div>

              <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden mt-2 flex">
                <div
                  className="bg-emerald-500 transition-all duration-500"
                  style={{ width: `${passRate}%` }}
                />
                <div
                  className="bg-rose-500 transition-all duration-500"
                  style={{ width: `${failRate}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Cookie 监控 */}
      <div className="p-3 m-2.5 rounded-xl bg-slate-900 text-slate-100 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold flex items-center gap-1.5 text-slate-300">
            <Cookie className="w-3.5 h-3.5" /> 会话 Cookie 监控
          </span>
          <button
            onClick={onOpenAuth}
            className="text-[10px] px-2 py-0.5 rounded bg-[#1a1a1a] hover:bg-black text-white"
          >
            配置鉴权
          </button>
        </div>
        <div className="text-[10px] font-mono text-slate-400 truncate">
          {activeTask?.config?.baseUrl || "未配置地址"}
        </div>
        {Object.keys(cookieMap).length === 0 ? (
          <div className="text-[10px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
            ⚠️ 当前无活跃 Cookie（受保护接口将返回 401）
          </div>
        ) : (
          <div className="space-y-1">
            {Object.entries(cookieMap).map(([k, v]) => (
              <div
                key={k}
                className="text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded truncate"
              >
                {k}={v}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
