import { useEffect, useState } from "react";
import { Play, Save } from "lucide-react";
import type { TestConfig, TestTask, TestTaskConfig } from "../types/pipeline";
import { EMPTY_LOGIN } from "../lib/constants";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export interface TaskDialogPayload {
  name: string;
  config: TestTaskConfig;
}

const EMPTY_CONFIG: TestTaskConfig = {
  projectName: "",
  baseUrl: "",
  apiSpec: "",
  prdText: "",
  authMode: "none",
  cookie: "",
  login: { ...EMPTY_LOGIN },
  headers: { "Content-Type": "application/json" },
};

/** 新建 / 编辑任务弹窗 */
export function TaskDialog({
  open,
  mode,
  task,
  configs,
  defaultConfig,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  task?: TestTask;
  configs: TestConfig[];
  defaultConfig?: TestConfig;
  onClose: () => void;
  onSubmit: (payload: TaskDialogPayload, run: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [configId, setConfigId] = useState("");
  const [cfg, setCfg] = useState<TestTaskConfig>(EMPTY_CONFIG);
  const [headersText, setHeadersText] = useState("{}");

  useEffect(() => {
    if (!open) return;
    const base =
      mode === "edit" && task
        ? task.config
        : defaultConfig
        ? pickConfig(defaultConfig)
        : EMPTY_CONFIG;
    setName(
      mode === "edit" && task
        ? task.name
        : `${base.projectName || "新任务"} · ${new Date().toLocaleTimeString()}`
    );
    setConfigId(mode === "edit" ? task?.configId || "" : defaultConfig?.id || "");
    setCfg({ ...EMPTY_CONFIG, ...base });
    setHeadersText(JSON.stringify(base.headers || {}, null, 2));
  }, [open, mode, task, defaultConfig]);

  const changeConfig = (id: string) => {
    setConfigId(id);
    const c = configs.find((x) => x.id === id);
    if (!c) return;
    const next = pickConfig(c);
    setCfg({ ...EMPTY_CONFIG, ...next });
    setHeadersText(JSON.stringify(next.headers || {}, null, 2));
    if (!name.trim() || /^\S+ · \d/.test(name)) {
      setName(`${next.projectName} · ${new Date().toLocaleTimeString()}`);
    }
  };

  const submit = (run: boolean) => {
    let headers: Record<string, string> = {};
    try {
      const parsed = JSON.parse(headersText || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        headers = parsed;
      }
    } catch {
      /* 非法 JSON 时忽略请求头 */
    }
    onSubmit(
      {
        name: name.trim() || `${cfg.projectName || "未命名"} · ${new Date().toLocaleTimeString()}`,
        config: { ...cfg, headers },
      },
      run
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "新建任务" : "编辑任务"}</DialogTitle>
          <DialogDescription>
            任务会同时执行正例与反例；反例只生成一次，重跑复用，可在对话里追加
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>任务名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>基于配置</Label>
              <Select value={configId} onValueChange={changeConfig}>
                <SelectTrigger>
                  <SelectValue placeholder="选择配置（可留空手填）" />
                </SelectTrigger>
                <SelectContent>
                  {configs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>项目名</Label>
              <Input
                value={cfg.projectName}
                onChange={(e) => setCfg({ ...cfg, projectName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>API Base URL</Label>
              <Input
                value={cfg.baseUrl}
                onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
                className="font-mono"
                placeholder="http://10.12.1.25:48997"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>接口定义（API JSON）</Label>
            <Textarea
              value={cfg.apiSpec}
              onChange={(e) => setCfg({ ...cfg, apiSpec: e.target.value })}
              className="h-32 font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label>产品需求文档（PRD）</Label>
            <Textarea
              value={cfg.prdText}
              onChange={(e) => setCfg({ ...cfg, prdText: e.target.value })}
              className="h-24"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>认证方式</Label>
              <Select
                value={cfg.authMode || "none"}
                onValueChange={(v) =>
                  setCfg({ ...cfg, authMode: v as TestTaskConfig["authMode"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不认证</SelectItem>
                  <SelectItem value="cookie">注入 Cookie</SelectItem>
                  <SelectItem value="login">登录前置</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>全局请求头（JSON）</Label>
              <Textarea
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                className="h-20 font-mono"
                spellCheck={false}
              />
            </div>
          </div>

          {cfg.authMode === "cookie" && (
            <div className="space-y-1.5">
              <Label>Cookie</Label>
              <Textarea
                value={cfg.cookie || ""}
                onChange={(e) => setCfg({ ...cfg, cookie: e.target.value })}
                className="h-16 font-mono"
                placeholder="JSESSIONID=xxx; other=yyy"
              />
            </div>
          )}

          {cfg.authMode === "login" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-3">
                <Label>CPS27 param</Label>
                <Input
                  value={cfg.login?.param || ""}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      login: { ...(cfg.login || EMPTY_LOGIN), param: e.target.value },
                    })
                  }
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>userPhone *</Label>
                <Input
                  value={cfg.login?.userPhone || ""}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      login: { ...(cfg.login || EMPTY_LOGIN), userPhone: e.target.value },
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>exhibitionId</Label>
                <Input
                  value={cfg.login?.exhibitionId || ""}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      login: {
                        ...(cfg.login || EMPTY_LOGIN),
                        exhibitionId: e.target.value,
                      },
                    })
                  }
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>tenant-id</Label>
                <Input
                  value={cfg.login?.tenantId || EMPTY_LOGIN.tenantId}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      login: { ...(cfg.login || EMPTY_LOGIN), tenantId: e.target.value },
                    })
                  }
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="secondary" onClick={() => submit(false)}>
            <Save className="w-3.5 h-3.5" /> 仅保存
          </Button>
          <Button onClick={() => submit(true)}>
            <Play className="w-3.5 h-3.5" /> 保存并执行
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function pickConfig(c: TestConfig): TestTaskConfig {
  return {
    projectName: c.projectName,
    baseUrl: c.baseUrl,
    apiSpec: c.apiSpec,
    prdText: c.prdText,
    authMode: c.authMode,
    cookie: c.cookie,
    login: c.login,
    headers: c.headers,
  };
}
