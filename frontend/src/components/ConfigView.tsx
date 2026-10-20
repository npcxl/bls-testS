import { useEffect, useRef, useState } from "react";
import { Braces, Cookie, LogIn, Play, Trash2, Upload } from "lucide-react";
import type { TestConfig } from "../types/pipeline";
import type { ConfigBuffer } from "../types/ui";
import { EMPTY_LOGIN } from "../lib/constants";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function ConfigView({
  config,
  buffer,
  patchBuffer,
  onHeadersChange,
  onSave,
  onRun,
  onDelete,
}: {
  config?: TestConfig;
  buffer: ConfigBuffer;
  patchBuffer: (patch: Partial<ConfigBuffer>) => void;
  onHeadersChange: (headers: Record<string, string>) => void;
  onSave: () => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const [headersText, setHeadersText] = useState(
    JSON.stringify(buffer.headers || { "Content-Type": "application/json" }, null, 2)
  );
  const [headersError, setHeadersError] = useState("");
  const apiFileRef = useRef<HTMLInputElement>(null);
  const prdFileRef = useRef<HTMLInputElement>(null);

  // 切换配置时同步请求头文本
  useEffect(() => {
    setHeadersText(JSON.stringify(buffer.headers || {}, null, 2));
    setHeadersError("");
  }, [config?.id]);

  const handleHeadersText = (text: string) => {
    setHeadersText(text);
    try {
      const parsed = JSON.parse(text || "{}");
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        setHeadersError("必须是 JSON 对象，如 {\"X-Tenant\":\"1\"}");
        return;
      }
      setHeadersError("");
      onHeadersChange(parsed as Record<string, string>);
    } catch {
      setHeadersError("JSON 格式错误");
    }
  };

  const readFileInto = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (v: string) => void
  ) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result || ""));
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const disabled = !config;

  return (
    <main className="flex-1 overflow-y-auto p-6 bg-[#F8FAFC]">
      <div className="max-w-4xl mx-auto space-y-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {config ? config.name : "尚未选择配置"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                配置可被多个任务复用；任务页选择它即可运行
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" onClick={onSave} disabled={disabled}>
                保存配置
              </Button>
              <Button onClick={onRun} disabled={disabled}>
                <Play className="w-3.5 h-3.5" /> 用此配置执行
              </Button>
              <Button variant="destructive" size="icon" onClick={onDelete} disabled={disabled}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>项目配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>配置名称 / 项目名</Label>
                <Input
                  value={buffer.projectName}
                  onChange={(e) => patchBuffer({ projectName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>API Base URL</Label>
                <Input
                  value={buffer.baseUrl}
                  onChange={(e) => patchBuffer({ baseUrl: e.target.value })}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1">
                  <Braces className="w-3.5 h-3.5" /> 接口定义 / API JSON
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => apiFileRef.current?.click()}
                >
                  <Upload className="w-3 h-3" /> 导入文件
                </Button>
                <input
                  ref={apiFileRef}
                  type="file"
                  accept=".json,.yaml,.yml,.md,.txt"
                  onChange={(e) => readFileInto(e, (v) => patchBuffer({ apiSpec: v }))}
                  className="hidden"
                />
              </div>
              <Textarea
                value={buffer.apiSpec}
                onChange={(e) => patchBuffer({ apiSpec: e.target.value })}
                className="h-56 font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>产品需求文档（PRD）</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => prdFileRef.current?.click()}
                >
                  <Upload className="w-3 h-3" /> 导入
                </Button>
                <input
                  ref={prdFileRef}
                  type="file"
                  accept=".md,.txt,.json,.yaml,.yml"
                  onChange={(e) => readFileInto(e, (v) => patchBuffer({ prdText: v }))}
                  className="hidden"
                />
              </div>
              <Textarea
                value={buffer.prdText}
                onChange={(e) => patchBuffer({ prdText: e.target.value })}
                className="h-40"
              />
            </div>
          </CardContent>
        </Card>

        {/* 全局请求头 */}
        <Card>
          <CardHeader>
            <CardTitle>全局请求头</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              会合并到所有用例（同名时覆盖模型生成的头）。鉴权头由「认证方式」统一注入，
              一般只需配置 Content-Type、tenant-id 等静态头。
            </p>
            <Textarea
              value={headersText}
              onChange={(e) => handleHeadersText(e.target.value)}
              className="h-28 font-mono"
              spellCheck={false}
            />
            {headersError && (
              <div className="text-[11px] text-rose-600">{headersError}</div>
            )}
          </CardContent>
        </Card>

        {/* 认证 */}
        <Card>
          <CardHeader>
            <CardTitle>认证方式</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <ModeButton
                active={buffer.authMode === "none"}
                onClick={() => patchBuffer({ authMode: "none" })}
                label="不认证"
              />
              <ModeButton
                active={buffer.authMode === "cookie"}
                onClick={() => patchBuffer({ authMode: "cookie" })}
                label="注入 Cookie"
                icon={<Cookie className="w-3.5 h-3.5" />}
              />
              <ModeButton
                active={buffer.authMode === "login"}
                onClick={() => patchBuffer({ authMode: "login" })}
                label="登录前置"
                icon={<LogIn className="w-3.5 h-3.5" />}
              />
            </div>

            {buffer.authMode === "cookie" && (
              <div className="space-y-1.5">
                <Label>Cookie（填了就跳过登录）</Label>
                <Textarea
                  value={buffer.cookie}
                  onChange={(e) => patchBuffer({ cookie: e.target.value })}
                  placeholder="JSESSIONID=xxxxxx; other=yyy"
                  className="h-20 font-mono"
                />
              </div>
            )}

            {buffer.authMode === "login" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>CPS27 param</Label>
                  <Input
                    value={buffer.login.param}
                    onChange={(e) =>
                      patchBuffer({ login: { ...buffer.login, param: e.target.value } })
                    }
                    placeholder="CPS27EFORM_..."
                    className="font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>userPhone *</Label>
                    <Input
                      value={buffer.login.userPhone}
                      onChange={(e) =>
                        patchBuffer({
                          login: { ...buffer.login, userPhone: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>exhibitionId</Label>
                    <Input
                      value={buffer.login.exhibitionId}
                      onChange={(e) =>
                        patchBuffer({
                          login: { ...buffer.login, exhibitionId: e.target.value },
                        })
                      }
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>boothNo（可留空）</Label>
                    <Input
                      value={buffer.login.boothNo}
                      onChange={(e) =>
                        patchBuffer({
                          login: { ...buffer.login, boothNo: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>companyId（可留空）</Label>
                    <Input
                      value={buffer.login.companyId}
                      onChange={(e) =>
                        patchBuffer({
                          login: { ...buffer.login, companyId: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>agency-id</Label>
                    <Input
                      value={buffer.login.agencyId}
                      onChange={(e) =>
                        patchBuffer({
                          login: { ...buffer.login, agencyId: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>tenant-id</Label>
                    <Input
                      value={buffer.login.tenantId || EMPTY_LOGIN.tenantId}
                      onChange={(e) =>
                        patchBuffer({
                          login: { ...buffer.login, tenantId: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function ModeButton({
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
    <Button variant={active ? "default" : "outline"} size="sm" onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
}
