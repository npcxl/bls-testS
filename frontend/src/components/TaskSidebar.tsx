import { Cookie, Lock, Pencil, Plus, Trash2, Unlock } from "lucide-react";
import type { TestTask } from "../types/pipeline";
import { authSummary, parseCookie, taskStatusMeta } from "../lib/labels";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";

export function TaskSidebar({
  tasks,
  activeTaskId,
  onSelect,
  onNewTask,
  onEditTask,
  onDeleteTask,
  onOpenAuth,
}: {
  tasks: TestTask[];
  activeTaskId: string;
  onSelect: (id: string) => void;
  onNewTask: () => void;
  onEditTask: (task: TestTask) => void;
  onDeleteTask: (task: TestTask) => void;
  onOpenAuth: () => void;
}) {
  const activeTask = tasks.find((t) => t.id === activeTaskId) || tasks[0];
  const cookieMap = parseCookie(activeTask?.config?.cookie);

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col shrink-0">
      <div className="p-3.5 border-b border-border">
        <Button className="w-full" onClick={onNewTask}>
          <Plus className="w-3.5 h-3.5" /> 新建任务
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2.5 space-y-2">
          <div className="px-1.5 py-1 flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <span>测试任务 ({tasks.length})</span>
            <span>状态</span>
          </div>

          {tasks.length === 0 && (
            <div className="px-2 py-4 text-[11px] text-muted-foreground">
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
                className={`group p-3 rounded-xl border transition-all cursor-pointer ${
                  active
                    ? "bg-secondary border-foreground/30 ring-1 ring-foreground/10"
                    : "bg-card border-border hover:bg-secondary/60"
                }`}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <span className="text-xs font-semibold text-foreground truncate">
                    {task.name}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditTask(task);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-accent"
                      title="编辑任务"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTask(task);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                      title="删除任务"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
                  <span className="font-mono text-[10px]">{task.createdAt}</span>
                  <Badge variant="outline" className={status.cls}>
                    {status.text}
                  </Badge>
                </div>

                <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-border text-[10px]">
                  <span className="flex items-center gap-1 text-muted-foreground truncate">
                    {auth.hasCookie ? (
                      <Lock className="w-3 h-3 text-emerald-600 shrink-0" />
                    ) : (
                      <Unlock className="w-3 h-3 text-amber-500 shrink-0" />
                    )}
                    <span className="truncate">{auth.label}</span>
                  </span>
                  <span className="font-mono text-muted-foreground shrink-0">
                    <b className="text-emerald-600">{pass}</b>/
                    <b className="text-rose-600">{fail}</b>/{total}
                  </span>
                </div>

                <div className="w-full h-1 bg-muted rounded-full overflow-hidden mt-2 flex">
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
      </ScrollArea>

      {/* Cookie 监控 */}
      <div className="p-3 m-2.5 rounded-xl bg-secondary border border-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold flex items-center gap-1.5 text-muted-foreground">
            <Cookie className="w-3.5 h-3.5" /> 会话 Cookie 监控
          </span>
          <Button size="sm" onClick={onOpenAuth}>
            配置鉴权
          </Button>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground truncate">
          {activeTask?.config?.baseUrl || "未配置地址"}
        </div>
        {Object.keys(cookieMap).length === 0 ? (
          <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            ⚠️ 当前无活跃 Cookie（受保护接口将返回 401）
          </div>
        ) : (
          <div className="space-y-1">
            {Object.entries(cookieMap).map(([k, v]) => (
              <div
                key={k}
                className="text-[10px] font-mono bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded truncate"
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
