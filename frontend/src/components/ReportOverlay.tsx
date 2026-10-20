import ReactMarkdown from "react-markdown";
import { FileDown, X } from "lucide-react";
import { API_BASE } from "../services/api";

/** Markdown 报告浮层（真实渲染） */
export function ReportOverlay({
  markdown,
  reportFile,
  onClose,
  onDownload,
}: {
  markdown: string;
  reportFile: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="absolute inset-0 bg-white z-20 flex flex-col">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">
            Markdown 报告预览
          </div>
          {reportFile && (
            <div className="text-[11px] text-slate-400 font-mono truncate">
              {reportFile}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onDownload}
            disabled={!markdown}
            className="bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-slate-300"
          >
            <FileDown className="w-3.5 h-3.5" /> 导出 .MD
          </button>
          <button
            onClick={() =>
              window.open(`${API_BASE}/api/pipeline/report/download`, "_blank")
            }
            disabled={!reportFile}
            className="bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-slate-300"
          >
            <FileDown className="w-3.5 h-3.5" /> 报告文件
          </button>
          <button
            onClick={onClose}
            className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" /> 关闭
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 prose prose-slate max-w-none text-sm">
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}
