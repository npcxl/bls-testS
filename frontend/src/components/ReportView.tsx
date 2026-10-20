import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, Copy, FileDown, FileText, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { API_BASE } from "../services/api";

/** Markdown 报告查看器：摘要头 + 工具栏 + 排版优化的正文 */
export function ReportView({
  markdown,
  fileName,
  title,
  baseUrl,
  total,
  passed,
  failed,
}: {
  markdown: string;
  fileName: string;
  title: string;
  baseUrl?: string;
  total: number;
  passed: number;
  failed: number;
}) {
  const [copied, setCopied] = useState(false);
  const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const copyAll = () => {
    try {
      navigator.clipboard?.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const exportMd = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "report"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 p-5 min-h-0 overflow-y-auto bg-[#F8FAFC]">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* 摘要头 */}
        <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold truncate">{title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {baseUrl && <span className="font-mono">{baseUrl}</span>}
                {fileName && <span className="font-mono truncate">{fileName}</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[11px] text-muted-foreground">通过率</div>
              <div
                className={`text-2xl font-bold tabular-nums ${
                  Number(rate) >= 80
                    ? "text-emerald-600"
                    : Number(rate) >= 50
                    ? "text-amber-600"
                    : "text-rose-600"
                }`}
              >
                {rate}%
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Metric
              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
              label="通过"
              value={passed}
              cls="border-emerald-200 bg-emerald-50 text-emerald-700"
            />
            <Metric
              icon={<XCircle className="w-3.5 h-3.5" />}
              label="失败"
              value={failed}
              cls="border-rose-200 bg-rose-50 text-rose-700"
            />
            <Metric
              label="总数"
              value={total}
              cls="border-border bg-secondary text-foreground"
            />
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={!markdown} onClick={copyAll}>
                <Copy className="w-3 h-3" /> {copied ? "已复制" : "复制全文"}
              </Button>
              <Button variant="outline" size="sm" disabled={!markdown} onClick={exportMd}>
                <FileDown className="w-3 h-3" /> 导出 .MD
              </Button>
              <Button
                size="sm"
                disabled={!fileName}
                onClick={() =>
                  window.open(
                    `${API_BASE}/api/pipeline/report/download?file=${encodeURIComponent(
                      fileName
                    )}`,
                    "_blank"
                  )
                }
              >
                <FileText className="w-3 h-3" /> 服务端报告
              </Button>
            </div>
          </div>
        </div>

        {/* 正文 */}
        <div className="rounded-2xl border border-border bg-card px-6 py-5 shadow-sm">
          {markdown ? (
            <article className="prose prose-slate max-w-none text-[13px] leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // 顶部已展示任务名/摘要，隐藏正文里的重复大标题
                  h1: () => null,
                  h2: ({ node: _n, ...props }) => (
                    <h2
                      className="mt-8 mb-3 border-b border-border pb-2 text-sm font-semibold text-foreground"
                      {...props}
                    />
                  ),
                  h3: ({ node: _n, ...props }) => (
                    <h3
                      className="mt-5 mb-2 border-l-2 border-foreground pl-2 text-[13px] font-semibold"
                      {...props}
                    />
                  ),
                  p: ({ node: _n, ...props }) => (
                    <p className="my-2 text-[13px] text-slate-700" {...props} />
                  ),
                  ul: ({ node: _n, ...props }) => (
                    <ul className="my-2 list-disc space-y-1 pl-5 text-[13px]" {...props} />
                  ),
                  ol: ({ node: _n, ...props }) => (
                    <ol className="my-2 list-decimal space-y-1 pl-5 text-[13px]" {...props} />
                  ),
                  table: ({ node: _n, ...props }) => (
                    <div className="my-4 overflow-x-auto rounded-xl border border-border">
                      <table className="w-full border-collapse text-[11px]" {...props} />
                    </div>
                  ),
                  thead: ({ node: _n, ...props }) => (
                    <thead className="bg-secondary/70" {...props} />
                  ),
                  th: ({ node: _n, ...props }) => (
                    <th
                      className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold text-slate-600"
                      {...props}
                    />
                  ),
                  td: ({ node: _n, ...props }) => (
                    <td
                      className="border-b border-slate-100 px-3 py-2 align-top text-slate-600"
                      {...props}
                    />
                  ),
                  tr: ({ node: _n, ...props }) => (
                    <tr className="hover:bg-secondary/40" {...props} />
                  ),
                  pre: ({ node: _n, ...props }) => (
                    <pre
                      className="my-3 max-h-80 overflow-auto rounded-xl bg-[#0f172a] p-3 text-[11px] leading-relaxed text-slate-100"
                      {...props}
                    />
                  ),
                  code: ({ node: _n, className, ...props }) => (
                    <code
                      className={`${className || ""} ${
                        className
                          ? ""
                          : "rounded bg-secondary px-1 py-0.5 text-[11px] text-rose-600"
                      }`}
                      {...props}
                    />
                  ),
                  a: ({ node: _n, ...props }) => (
                    <a className="text-foreground underline underline-offset-2" {...props} />
                  ),
                  blockquote: ({ node: _n, ...props }) => (
                    <blockquote
                      className="my-3 border-l-2 border-border pl-3 text-[12px] text-muted-foreground"
                      {...props}
                    />
                  ),
                  hr: () => <hr className="my-6 border-border" />,
                }}
              >
                {markdown}
              </ReactMarkdown>
            </article>
          ) : (
            <div className="py-16 text-center text-xs text-muted-foreground">
              该任务还没有生成报告，执行一次后即可查看。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  cls,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  cls: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${cls}`}
    >
      {icon}
      <span className="opacity-70">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}
