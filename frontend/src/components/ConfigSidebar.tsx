import { Plus } from "lucide-react";
import type { TestConfig } from "../types/pipeline";

export function ConfigSidebar({
  configs,
  activeConfigId,
  onSelect,
  onCreate,
}: {
  configs: TestConfig[];
  activeConfigId: string;
  onSelect: (cfg: TestConfig) => void;
  onCreate: () => void;
}) {
  return (
    <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col">
      <div className="px-3 py-3 border-b border-slate-200">
        <button
          onClick={onCreate}
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
            onClick={() => onSelect(c)}
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
  );
}
