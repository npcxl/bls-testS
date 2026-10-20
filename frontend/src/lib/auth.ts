import type { TaskLoginConfig, TestTaskConfig } from "../types/pipeline";

/** 按任务的认证配置生成后端 auth 参数 */
export function buildAuth(cfg: TestTaskConfig) {
  const extra = Object.fromEntries(
    Object.entries({
      "agency-id": (cfg.login?.agencyId || "").trim(),
      "tenant-id": (cfg.login?.tenantId || "").trim(),
    }).filter(([, v]) => v)
  );

  if (cfg.authMode === "cookie" && cfg.cookie?.trim()) {
    return { cookie: cfg.cookie.trim(), extra_headers: extra };
  }

  if (cfg.authMode === "login" && cfg.login?.userPhone?.trim()) {
    const l: TaskLoginConfig = cfg.login;
    return {
      login_path: "/login/syncLogin",
      method: "POST",
      body: Object.fromEntries(
        Object.entries({
          userPhone: l.userPhone.trim(),
          companyId: l.companyId.trim(),
          boothNo: l.boothNo.trim(),
          exhibitionId: l.exhibitionId.trim(),
          expoId: l.exhibitionId.trim(),
        }).filter(([, v]) => v)
      ),
      param: l.param?.trim() || undefined,
      exhibition_id: l.exhibitionId?.trim() || undefined,
      token_json_path: "$.data.token|$.token",
      header_name: "Authorization",
      header_prefix: "Bearer ",
      extra_headers: extra,
    };
  }

  return undefined;
}
