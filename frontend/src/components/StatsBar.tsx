import { AlertTriangle, CheckCircle2, Clock, Layers, XCircle } from "lucide-react";

export function StatsBar({
  total,
  passed,
  failed,
  authBlocked,
  elapsed,
}: {
  total: number;
  passed: number;
  failed: number;
  authBlocked: number;
  elapsed: number;
}) {
  const cards = [
    {
      label: "生成反例总数",
      value: total,
      color: "text-slate-900",
      icon: <Layers className="w-4 h-4" />,
      iconCls: "bg-slate-100 text-[#1a1a1a]",
    },
    {
      label: "符合预期拦截 (PASS)",
      value: passed,
      color: "text-emerald-600",
      icon: <CheckCircle2 className="w-4 h-4" />,
      iconCls: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "发现缺陷/未拦截 (FAIL)",
      value: failed,
      color: "text-rose-600",
      icon: <XCircle className="w-4 h-4" />,
      iconCls: "bg-rose-50 text-rose-600",
    },
    {
      label: "401 需登录阻断",
      value: authBlocked,
      color: "text-amber-600",
      icon: <AlertTriangle className="w-4 h-4" />,
      iconCls: "bg-amber-50 text-amber-600",
    },
    {
      label: "并发总耗时",
      value: `${elapsed}s`,
      color: "text-slate-800 font-mono",
      icon: <Clock className="w-4 h-4" />,
      iconCls: "bg-slate-100 text-slate-600",
    },
  ];

  return (
    <section className="px-5 pt-4 pb-2 grid grid-cols-5 gap-3 shrink-0">
      {cards.map((c) => (
        <div
          key={c.label}
          className="bg-white border border-slate-200/80 rounded-xl p-3 flex items-center justify-between shadow-sm"
        >
          <div>
            <div className="text-[11px] text-slate-500">{c.label}</div>
            <div className={`text-xl font-bold mt-0.5 ${c.color}`}>{c.value}</div>
          </div>
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${c.iconCls}`}
          >
            {c.icon}
          </div>
        </div>
      ))}
    </section>
  );
}
