export const SAMPLE_API_SPEC = `{
  "project": "订单中心",
  "base_url": "https://api.example.com",
  "endpoints": [
    {
      "method": "POST",
      "path": "/api/v1/orders",
      "summary": "创建订单",
      "auth": "Bearer",
      "body": { "sku_id": "string, required", "quantity": "int, required, 1~99" }
    }
  ]
}`;

export const SAMPLE_PRD = `接口：POST /api/v1/orders 创建订单
必填字段：sku_id (string), quantity (int, 1~99)。
业务规则：下单数量不可为 0 或负数；未登录用户禁止下单。`;

export const EMPTY_LOGIN = {
  param: "",
  userPhone: "",
  exhibitionId: "",
  boothNo: "",
  companyId: "",
  agencyId: "",
  tenantId: "358",
};

/** 反例分类配色 */
export const CATEGORY_STYLE: Record<string, string> = {
  MissingField: "bg-rose-50 text-rose-600 border-rose-200",
  InvalidType: "bg-amber-50 text-amber-600 border-amber-200",
  BoundaryOverflow: "bg-orange-50 text-orange-600 border-orange-200",
  NullValue: "bg-sky-50 text-sky-600 border-sky-200",
  SecurityInjection: "bg-purple-50 text-purple-600 border-purple-200",
  BusinessLogicViolation: "bg-slate-100 text-[#1a1a1a] border-slate-300",
  AuthBypass: "bg-slate-100 text-slate-600 border-slate-300",
};

export const inputCls =
  "w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a1a1a]/15 focus:border-[#1a1a1a]";
