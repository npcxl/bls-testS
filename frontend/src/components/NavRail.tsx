import { ListChecks, Settings, Sliders } from "lucide-react";
import type { View } from "../types/ui";

const ITEMS: { key: View; label: string; icon: React.ReactNode }[] = [
  { key: "run", label: "任务", icon: <ListChecks className="w-4 h-4" /> },
  { key: "config", label: "配置", icon: <Sliders className="w-4 h-4" /> },
  { key: "settings", label: "设置", icon: <Settings className="w-4 h-4" /> },
];

export function NavRail({
  view,
  onChange,
}: {
  view: View;
  onChange: (v: View) => void;
}) {
  return (
    <aside className="w-16 bg-white border-r border-slate-200 flex flex-col items-center py-4 justify-between shrink-0">
      <nav className="flex flex-col gap-2">
        {ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${
              view === item.key
                ? "bg-[#1a1a1a] text-white"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {item.icon}
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="flex flex-col items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
        <span className="text-[9px] text-slate-400 font-mono">Rust</span>
      </div>
    </aside>
  );
}
