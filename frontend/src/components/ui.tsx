import React from "react";
import type { TestTask } from "../types/pipeline";
import type { RunStatus } from "../types/ui";

export function Field({
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

export function ModeButton({
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
          ? "border-[#1a1a1a] bg-[#1a1a1a] text-white"
          : "border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

type TagTone = "slate" | "indigo" | "amber" | "emerald" | "rose";

const TAG_TONE: Record<TagTone, string> = {
  slate: "bg-white text-slate-500 border-slate-200",
  indigo: "bg-slate-100 text-[#1a1a1a] border-slate-300",
  amber: "bg-amber-50 text-amber-600 border-amber-200",
  emerald: "bg-emerald-50 text-emerald-600 border-emerald-200",
  rose: "bg-rose-50 text-rose-600 border-rose-200",
};

export function StatTag({
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

export function SectionTitle({
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

export function Skeleton({ lines }: { lines: number }) {
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

export function StatusDot({ status }: { status: RunStatus }) {
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

export function TaskBadge({ task }: { task: TestTask }) {
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

export function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-slate-700 font-mono text-[11px] truncate">{value}</div>
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-slate-500 mb-1">{title}</div>
      {children}
    </div>
  );
}
