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
    <aside className="w-16 bg-[#0F172A] text-slate-400 flex flex-col items-center py-4 justify-between shrink-0 border-r border-slate-800">
      <div className="flex flex-col items-center gap-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-indigo-500/30 tracking-wider">
          BLS
        </div>

        <nav className="flex flex-col gap-2">
          {ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => onChange(item.key)}
              className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${
                view === item.key
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "hover:bg-slate-800/80 hover:text-slate-200"
              }`}
            >
              {item.icon}
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20" />
        <span className="text-[9px] text-slate-400 font-mono">Rust</span>
      </div>
    </aside>
  );
}
