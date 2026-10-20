import { ListTodo, Play } from "lucide-react";

export function EmptyState({
  hasTask,
  hasConfig,
  canRun,
  onRun,
}: {
  hasTask: boolean;
  hasConfig: boolean;
  canRun: boolean;
  onRun: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <ListTodo className="w-7 h-7 text-slate-400" />
      </div>
      <div className="text-sm font-medium text-slate-700">
        {hasConfig ? "选择配置并运行" : "还没有配置"}
      </div>
      <div className="text-xs text-slate-400 mt-1 max-w-md leading-relaxed">
        {hasConfig
          ? hasTask
            ? "该任务还没有执行记录，点下方按钮开始生成反例并执行。"
            : "在右上角选择配置后点「运行」，或先点左侧「新建任务」。"
          : "先到「配置」页新建配置（项目地址 + 接口定义 + PRD）。"}
      </div>
      {canRun && (
        <button
          onClick={onRun}
          className="mt-4 px-3 py-1.5 rounded-md bg-[#1a1a1a] hover:bg-black text-white text-xs flex items-center gap-1.5"
        >
          <Play className="w-3.5 h-3.5" /> 开始执行
        </button>
      )}
    </div>
  );
}
