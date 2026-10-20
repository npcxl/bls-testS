import { useRef, useState } from "react";
import { Braces, Cookie, LogIn, Play, Trash2, Upload } from "lucide-react";
import type { TestConfig } from "../types/pipeline";
import type { ConfigBuffer } from "../types/ui";
import { EMPTY_LOGIN, inputCls } from "../lib/constants";
import { Field, ModeButton } from "./ui";

export function ConfigView({
  config,
  buffer,
  patchBuffer,
  onSave,
  onRun,
  onDelete,
}: {
  config?: TestConfig;
  buffer: ConfigBuffer;
  patchBuffer: (patch: Partial<ConfigBuffer>) => void;
  onSave: () => void;
  onRun: () => void;
  onDelete: () => void;
}) {
  const [importName, setImportName] = useState("");
  const apiFileRef = useRef<HTMLInputElement>(null);
  const prdFileRef = useRef<HTMLInputElement>(null);

  const readFileInto = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (v: string) => void
  ) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setter(String(reader.result || ""));
      setImportName(file.name);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const disabled = !config;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* 顶部操作 */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900 truncate">
              {config ? config.name : "尚未选择配置"}
            </div>
            <div className="text-[11px] text-slate-400">
              配置可被多个任务复用；任务页选择它即可运行
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onSave}
              disabled={disabled}
              className="px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              保存配置
            </button>
            <button
              onClick={onRun}
              disabled={disabled}
              className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              <Play className="w-4 h-4" /> 用此配置执行
            </button>
            <button
              onClick={onDelete}
              disabled={disabled}
              className="px-2 py-1.5 rounded-md border border-rose-200 text-rose-600 text-sm hover:bg-rose-50 disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 项目配置 */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="配置名称 / 项目名">
              <input
                value={buffer.projectName}
                onChange={(e) => patchBuffer({ projectName: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="API Base URL">
              <input
                value={buffer.baseUrl}
                onChange={(e) => patchBuffer({ baseUrl: e.target.value })}
                className={`${inputCls} font-mono`}
              />
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-500 flex items-center gap-1">
                <Braces className="w-3.5 h-3.5" /> 接口定义 / API JSON
              </label>
              <div className="flex items-center gap-2">
                {importName && (
                  <span className="text-[10px] text-slate-400">{importName}</span>
                )}
                <button
                  onClick={() => apiFileRef.current?.click()}
                  className="text-[11px] text-indigo-600 border border-indigo-200 bg-indigo-50 px-2 py-0.5 rounded flex items-center gap-1"
                >
                  <Upload className="w-3 h-3" /> 导入文件
                </button>
                <input
                  ref={apiFileRef}
                  type="file"
                  accept=".json,.yaml,.yml,.md,.txt"
                  onChange={(e) =>
                    readFileInto(e, (v) => patchBuffer({ apiSpec: v }))
                  }
                  className="hidden"
                />
              </div>
            </div>
            <textarea
              value={buffer.apiSpec}
              onChange={(e) => patchBuffer({ apiSpec: e.target.value })}
              className={`${inputCls} h-56 font-mono text-xs`}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-500">
                产品需求文档（PRD）
              </label>
              <button
                onClick={() => prdFileRef.current?.click()}
                className="text-[11px] text-slate-600 border border-slate-200 bg-slate-50 px-2 py-0.5 rounded flex items-center gap-1"
              >
                <Upload className="w-3 h-3" /> 导入
              </button>
              <input
                ref={prdFileRef}
                type="file"
                accept=".md,.txt,.json,.yaml,.yml"
                onChange={(e) => readFileInto(e, (v) => patchBuffer({ prdText: v }))}
                className="hidden"
              />
            </div>
            <textarea
              value={buffer.prdText}
              onChange={(e) => patchBuffer({ prdText: e.target.value })}
              className={`${inputCls} h-40 text-xs`}
            />
          </div>
        </div>

        {/* 认证 */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium">认证方式</h3>
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
            <Field label="Cookie（填了就跳过登录）">
              <textarea
                value={buffer.cookie}
                onChange={(e) => patchBuffer({ cookie: e.target.value })}
                placeholder="JSESSIONID=xxxxxx; other=yyy"
                className={`${inputCls} h-20 font-mono text-xs`}
              />
            </Field>
          )}

          {buffer.authMode === "login" && (
            <div className="space-y-3">
              <Field label="CPS27 param">
                <input
                  value={buffer.login.param}
                  onChange={(e) =>
                    patchBuffer({ login: { ...buffer.login, param: e.target.value } })
                  }
                  placeholder="CPS27EFORM_..."
                  className={`${inputCls} font-mono text-xs`}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="userPhone *">
                  <input
                    value={buffer.login.userPhone}
                    onChange={(e) =>
                      patchBuffer({
                        login: { ...buffer.login, userPhone: e.target.value },
                      })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="exhibitionId">
                  <input
                    value={buffer.login.exhibitionId}
                    onChange={(e) =>
                      patchBuffer({
                        login: { ...buffer.login, exhibitionId: e.target.value },
                      })
                    }
                    className={`${inputCls} font-mono text-xs`}
                  />
                </Field>
                <Field label="boothNo（可留空）">
                  <input
                    value={buffer.login.boothNo}
                    onChange={(e) =>
                      patchBuffer({
                        login: { ...buffer.login, boothNo: e.target.value },
                      })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="companyId（可留空）">
                  <input
                    value={buffer.login.companyId}
                    onChange={(e) =>
                      patchBuffer({
                        login: { ...buffer.login, companyId: e.target.value },
                      })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="agency-id">
                  <input
                    value={buffer.login.agencyId}
                    onChange={(e) =>
                      patchBuffer({
                        login: { ...buffer.login, agencyId: e.target.value },
                      })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="tenant-id">
                  <input
                    value={buffer.login.tenantId || EMPTY_LOGIN.tenantId}
                    onChange={(e) =>
                      patchBuffer({
                        login: { ...buffer.login, tenantId: e.target.value },
                      })
                    }
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
