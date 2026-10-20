import { Cookie, KeyRound, Plus, Send, Sparkles } from "lucide-react";
import type { ChatMessage } from "../types/pipeline";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";

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
      <div className="bg-card border border-border rounded-2xl shadow-sm p-3 space-y-2.5">
        <div className="max-h-24 overflow-y-auto space-y-1.5 pr-1">
          {recent.length === 0 && (
            <div className="text-[11px] text-muted-foreground px-1">
              用自然语言补充测试需求，例如「再加一些支付回调的越权场景」
            </div>
          )}
          {recent.map((log, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-2 text-xs px-3 py-1.5 rounded-xl ${
                log.role === "assistant"
                  ? "bg-secondary text-foreground border border-border"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Sparkles
                className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                  log.role === "assistant" ? "text-foreground" : "text-muted-foreground"
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
          <span className="text-[11px] font-semibold text-muted-foreground">
            快捷指令:
          </span>
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-accent"
            onClick={() =>
              !disabled &&
              onSend(
                "这些接口需要先登录再测试：先调登录接口，自动保持 Set-Cookie 并提取 token 重跑反例"
              )
            }
          >
            <KeyRound className="w-3 h-3" /> ① 这些接口需要先登录再测试
          </Badge>
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-accent"
            onClick={() => !disabled && onSend("直接用我抓包的 Cookie 测试，跳过登录流程")}
          >
            <Cookie className="w-3 h-3" /> ② 用浏览器 Cookie 重测
            {hasCookie ? "（已挂载）" : ""}
          </Badge>
          <Badge
            variant="outline"
            className="cursor-pointer hover:bg-accent"
            onClick={() =>
              !disabled && onSend("补充一条光地展位面积小于最小限制的业务反例")
            }
          >
            <Plus className="w-3 h-3" /> ③ 追加「光地面积小于 36㎡」反例
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSend()}
            disabled={disabled}
            placeholder="继续用自然语言说出接下来的测试需求，如：再加一些支付回调的越权场景…"
            className="h-9"
          />
          <Button onClick={() => onSend()} disabled={disabled} className="h-9 shrink-0">
            <Send className="w-3.5 h-3.5" /> 发送指令
          </Button>
        </div>
      </div>
    </footer>
  );
}
