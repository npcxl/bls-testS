import type { NegativeTestCase, TestTask, TestTaskConfig } from "../types/pipeline";

const CATEGORY_LABEL: Record<string, string> = {
  MissingField: "必填缺失",
  InvalidType: "类型变异",
  BoundaryOverflow: "边界溢出",
  NullValue: "空值",
  SecurityInjection: "安全注入",
  BusinessLogicViolation: "业务逻辑",
  AuthBypass: "鉴权绕过",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] || category || "未知";
}

/** 用例的鉴权模式：鉴权绕过类视为伪造 Cookie */
export function caseAuthMode(c: NegativeTestCase): "Authenticated" | "TamperedCookie" {
  return (c.category || "").toLowerCase() === "authbypass"
    ? "TamperedCookie"
    : "Authenticated";
}

export function taskStatusMeta(status: TestTask["status"]): {
  text: string;
  cls: string;
} {
  switch (status) {
    case "running":
      return { text: "执行中", cls: "bg-amber-50 text-amber-700 border border-amber-200" };
    case "done":
      return {
        text: "已完成",
        cls: "bg-emerald-50 text-emerald-700 border border-emerald-200",
      };
    case "failed":
      return { text: "失败", cls: "bg-rose-50 text-rose-700 border border-rose-200" };
    default:
      return { text: "待执行", cls: "bg-slate-100 text-slate-600 border border-slate-200" };
  }
}

/** 认证方式摘要（侧栏卡片展示） */
export function authSummary(cfg?: TestTaskConfig): {
  label: string;
  hasCookie: boolean;
} {
  if (!cfg) return { label: "未配置认证", hasCookie: false };
  if (cfg.authMode === "cookie" && cfg.cookie?.trim()) {
    return { label: "手动 Cookie 已挂载", hasCookie: true };
  }
  if (cfg.authMode === "login" && cfg.login?.userPhone?.trim()) {
    return {
      label: `前置登录 ${cfg.login.param ? "+ param" : ""}`.trim(),
      hasCookie: true,
    };
  }
  return { label: "未配置登录", hasCookie: false };
}

/** 解析 Cookie 字符串为键值对 */
export function parseCookie(raw?: string): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  raw.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx <= 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}
