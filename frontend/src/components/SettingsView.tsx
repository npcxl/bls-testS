import { KeyRound } from "lucide-react";
import { inputCls } from "../lib/constants";
import { Field } from "./ui";

export function SettingsView({
  apiKey,
  model,
  baseUrl,
  onApiKey,
  onModel,
  onBaseUrl,
  onClearAll,
}: {
  apiKey: string;
  model: string;
  baseUrl: string;
  onApiKey: (v: string) => void;
  onModel: (v: string) => void;
  onBaseUrl: (v: string) => void;
  onClearAll: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">设置</h2>

        <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <KeyRound className="w-4 h-4 text-amber-500" /> DeepSeek
          </h3>
          <Field label="API Key">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => onApiKey(e.target.value)}
              placeholder="sk-..."
              className={`${inputCls} font-mono`}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="模型">
              <select
                value={model}
                onChange={(e) => onModel(e.target.value)}
                className={inputCls}
              >
                <option value="deepseek-chat">deepseek-chat</option>
                <option value="deepseek-reasoner">deepseek-reasoner</option>
              </select>
            </Field>
            <Field label="Base URL">
              <input
                value={baseUrl}
                onChange={(e) => onBaseUrl(e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </Field>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-medium">本地数据</h3>
          <p className="text-[11px] text-slate-400">
            配置、任务与报告保存在本机浏览器，最多 30 个任务 / 50 个配置。
          </p>
          <button
            onClick={onClearAll}
            className="px-3 py-1.5 rounded-md border border-rose-200 text-rose-600 text-sm hover:bg-rose-50"
          >
            清空本机数据
          </button>
        </section>
      </div>
    </div>
  );
}
