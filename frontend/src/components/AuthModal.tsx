import { useState } from "react";
import { Cookie, LogIn, X } from "lucide-react";
import type { TestConfig } from "../types/pipeline";
import { inputCls } from "../lib/constants";

/** 鉴权配置弹窗：注入 Cookie 或 启用前置登录 */
export function AuthModal({
  config,
  onClose,
  onSaveCookie,
  onSaveLogin,
}: {
  config?: TestConfig;
  onClose: () => void;
  onSaveCookie: (cookie: string) => void;
  onSaveLogin: (payload: { param: string; userPhone: string; exhibitionId: string }) => void;
}) {
  const [cookie, setCookie] = useState(config?.cookie || "");
  const [param, setParam] = useState(config?.login?.param || "");
  const [phone, setPhone] = useState(config?.login?.userPhone || "");
  const [exhibitionId, setExhibitionId] = useState(config?.login?.exhibitionId || "");

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Cookie className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              项目鉴权与 Cookie 会话配置
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              方式一：直接粘贴浏览器 Cookie（适合有图形验证码 / SSO 的系统）
            </label>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              rows={3}
              placeholder="CPS_SESSION=xxx; XSRF-TOKEN=yyy"
              className={`${inputCls} font-mono text-[11px]`}
            />
            <button
              onClick={() => onSaveCookie(cookie)}
              className="mt-2 w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              注入 Cookie 并立即重跑反例
            </button>
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-2">
            <label className="font-semibold text-slate-700 flex items-center gap-1.5">
              <LogIn className="w-3.5 h-3.5" /> 方式二：前置登录接口（自动取 token 与会话）
            </label>
            <input
              value={param}
              onChange={(e) => setParam(e.target.value)}
              placeholder="CPS27 param（可选，如 CPS27EFORM_...）"
              className={`${inputCls} font-mono text-[11px]`}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="userPhone *"
                className={inputCls}
              />
              <input
                value={exhibitionId}
                onChange={(e) => setExhibitionId(e.target.value)}
                placeholder="exhibitionId"
                className={`${inputCls} font-mono text-[11px]`}
              />
            </div>
            <button
              onClick={() => onSaveLogin({ param, userPhone: phone, exhibitionId })}
              disabled={!phone.trim()}
              className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-40"
            >
              启用前置登录并重跑
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
