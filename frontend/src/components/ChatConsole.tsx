import { Cookie, KeyRound, Plus, Send, Sparkles } from "lucide-react";
import type { ChatMessage } from "../types/pipeline";

export function ChatConsole({
  logs,
  input,
  onInput,
  onSend,
  disabled,
  hasCookie,
}: {
  logs: ChatMessage[];
  input: string;
  onInput: (v: string) => void;
  onSend: (text?: string) => void;
  disabled: boolean;
  hasCookie: boolean;
}) {
  const recent = logs.slice(-2);

  return (
    <footer className="px-5 pb-4 pt-1 shrink-0">
      <div className="bg-white border border-slate-200/90 rounded-2xl shadow-md p-3 space-y-2.5">
        <div className="max-h-24 overflow-y-auto space-y-1.5 pr-1">
          {recent.length === 0 && (
            <div className="text-[11px] text-slate-400 px-1">
              用自然语言补充测试需求，例如「再加一些支付回调的越权场景」
            </div>
          )}
          {recent.map((log, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-2 text-xs px-3 py-1.5 rounded-xl ${
                log.role === "assistant"
                  ? "bg-slate-50 text-slate-800 border border-slate-200"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              <Sparkles
                className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                  log.role === "assistant" ? "text-[#1a1a1a]" : "text-slate-400"
                }`}
              />
              <div className="flex-1 leading-relaxed">
                <span className="font-semibold mr-1.5">
                  {log.role === "assistant" ? "DeepSeek 编排引擎:" : "你:"}
                </span>
                {log.content}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-400">
            快捷指令:
          </span>
          <button
            onClick={() =>
              onSend(
                "这些接口需要先登录再测试：先调登录接口，自动保持 Set-Cookie 并提取 token 重跑反例"
              )
            }
            disabled={disabled}
            className="px-2.5 py-1 rounded-full bg-amber-50 hover:bg-amber-100 border border-amber-200/80 text-amber-800 text-[11px] font-medium flex items-center gap-1 disabled:opacity-50"
          >
            <KeyRound className="w-3 h-3 text-amber-600" />
            ① 这些接口需要先登录再测试
          </button>
          <button
            onClick={() =>
              onSend("直接用我抓包的 Cookie 测试，跳过登录流程")
            }
            disabled={disabled}
            className="px-2.5 py-1 rounded-full bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 text-emerald-800 text-[11px] font-medium flex items-center gap-1 disabled:opacity-50"
          >
            <Cookie className="w-3 h-3 text-emerald-600" />
            ② 用浏览器 Cookie 重测{hasCookie ? "（已挂载）" : ""}
          </button>
          <button
            onClick={() => onSend("补充一条光地展位面积小于最小限制的业务反例")}
            disabled={disabled}
            className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-300 text-[#1a1a1a] text-[11px] font-medium flex items-center gap-1 disabled:opacity-50"
          >
            <Plus className="w-3 h-3 text-[#1a1a1a]" />
            ③ 追加「光地面积小于 36㎡」反例
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSend()}
            disabled={disabled}
            placeholder="继续用自然语言说出接下来的测试需求，如：再加一些支付回调的越权场景…"
            className="flex-1 px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:border-[#1a1a1a] focus:bg-white focus:outline-none text-xs text-slate-800 disabled:opacity-60"
          />
          <button
            onClick={() => onSend()}
            disabled={disabled}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-[#1a1a1a] text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" /> 发送指令
          </button>
        </div>
      </div>
    </footer>
  );
}
