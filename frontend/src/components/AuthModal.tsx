import { useState } from "react";
import { Cookie, LogIn } from "lucide-react";
import type { TestConfig } from "../types/pipeline";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";

/** 鉴权配置弹窗：注入 Cookie 或 启用前置登录 */
export function AuthModal({
  open,
  config,
  onClose,
  onSaveCookie,
  onSaveLogin,
}: {
  open: boolean;
  config?: TestConfig;
  onClose: () => void;
  onSaveCookie: (cookie: string) => void;
  onSaveLogin: (payload: {
    param: string;
    userPhone: string;
    exhibitionId: string;
  }) => void;
}) {
  const [cookie, setCookie] = useState(config?.cookie || "");
  const [param, setParam] = useState(config?.login?.param || "");
  const [phone, setPhone] = useState(config?.login?.userPhone || "");
  const [exhibitionId, setExhibitionId] = useState(
    config?.login?.exhibitionId || ""
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cookie className="h-4 w-4" /> 项目鉴权与 Cookie 会话配置
          </DialogTitle>
          <DialogDescription>
            配置会写回当前项目配置，并立即用新会话重跑当前任务
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>方式一：直接粘贴浏览器 Cookie</Label>
            <Textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              rows={3}
              placeholder="CPS_SESSION=xxx; XSRF-TOKEN=yyy"
              className="font-mono"
            />
            <Button className="w-full" onClick={() => onSaveCookie(cookie)}>
              注入 Cookie 并立即重跑反例
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <LogIn className="h-3.5 w-3.5" /> 方式二：前置登录接口（自动取 token
              与会话）
            </Label>
            <Input
              value={param}
              onChange={(e) => setParam(e.target.value)}
              placeholder="CPS27 param（可选，如 CPS27EFORM_...）"
              className="font-mono"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="userPhone *"
              />
              <Input
                value={exhibitionId}
                onChange={(e) => setExhibitionId(e.target.value)}
                placeholder="exhibitionId"
                className="font-mono"
              />
            </div>
            <Button
              className="w-full"
              disabled={!phone.trim()}
              onClick={() => onSaveLogin({ param, userPhone: phone, exhibitionId })}
            >
              启用前置登录并重跑
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
