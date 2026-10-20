import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Play,
  FileDown,
  Upload,
  Braces,
  KeyRound,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  Terminal,
  FileText,
  LogIn,
  X,
} from "lucide-react";
import { API_BASE, chatRefine, initAndRun, subscribeEvents } from "./services/api";
import type {
  CaseExecutionResult,
  ChatMessage,
  NegativeTestCase,
  PipelineEvent,
} from "./types/pipeline";

const SAMPLE_API_SPEC = `{
  "project": "订单中心",
  "base_url": "https://api.example.com",
  "endpoints": [
    {
      "method": "POST",
      "path": "/api/v1/orders",
      "summary": "创建订单",
      "auth": "Bearer",
      "body": {
        "sku_id": "string, required",
        "quantity": "int, required, 1~99",
        "coupon_code": "string, optional"
      },
      "responses": { "200": "创建成功", "400": "参数校验失败", "401": "未登录" }
    }
  ]
}`;

const SAMPLE_PRD = `接口：POST /api/v1/orders 创建订单
必填字段：sku_id (string), quantity (int, 1~99), coupon_code (optional string)。
业务规则：下单数量不可为 0 或负数；单笔最大 99 件；未登录用户禁止下单。`;

const CATEGORY_STYLE: Record<string, string> = {
  MissingField: "bg-rose-50 text-rose-600 border-rose-200",
  InvalidType: "bg-amber-50 text-amber-600 border-amber-200",
  BoundaryOverflow: "bg-orange-50 text-orange-600 border-orange-200",
  NullValue: "bg-sky-50 text-sky-600 border-sky-200",
  SecurityInjection: "bg-purple-50 text-purple-600 border-purple-200",
  BusinessLogicViolation: "bg-indigo-50 text-indigo-600 border-indigo-200",
  AuthBypass: "bg-slate-100 text-slate-600 border-slate-300",
};

type RunStatus = "idle" | "running" | "done" | "error";

export default function AutoTestWorkbench() {
  // ---------- 左侧配置 ----------
  const [projectName, setProjectName] = useState("订单中心 API");
  const [baseUrl, setBaseUrl] = useState("https://api.example.com");
  const [apiSpec, setApiSpec] = useState(SAMPLE_API_SPEC);
  const [prdText, setPrdText] = useState(SAMPLE_PRD);
  const [importName, setImportName] = useState("");

  const [dsKey, setDsKey] = useState<string>(
    () => localStorage.getItem("ds_api_key") || ""
  );
  const [dsModel, setDsModel] = useState<string>(
    () => localStorage.getItem("ds_model") || "deepseek-chat"
  );
  const [dsBase, setDsBase] = useState<string>(
    () => localStorage.getItem("ds_base_url") || "https://api.deepseek.com"
  );
  useEffect(() => {
    localStorage.setItem("ds_api_key", dsKey);
    localStorage.setItem("ds_model", dsModel);
    localStorage.setItem("ds_base_url", dsBase);
  }, [dsKey, dsModel, dsBase]);

  // 登录前置：填了手机号就首轮先登录，避免所有接口撞 401
  const [authPhone, setAuthPhone] = useState<string>(
    () => localStorage.getItem("auth_phone") || ""
  );
  const [authCompanyId, setAuthCompanyId] = useState<string>(
    () => localStorage.getItem("auth_company_id") || ""
  );
  const [authBoothNo, setAuthBoothNo] = useState<string>(
    () => localStorage.getItem("auth_booth_no") || ""
  );
  const [authExhibitionId, setAuthExhibitionId] = useState<string>(
    () => localStorage.getItem("auth_exhibition_id") || ""
  );
  const [authExpoId, setAuthExpoId] = useState<string>(
    () => localStorage.getItem("auth_expo_id") || ""
  );
  const [authAgencyId, setAuthAgencyId] = useState<string>(
    () => localStorage.getItem("auth_agency_id") || ""
  );
  const [authTenantId, setAuthTenantId] = useState<string>(
    () => localStorage.getItem("auth_tenant_id") || "358"
  );
  const [authParam, setAuthParam] = useState<string>(
    () => localStorage.getItem("auth_param") || ""
  );

  useEffect(() => {
    localStorage.setItem("auth_phone", authPhone);
    localStorage.setItem("auth_company_id", authCompanyId);
    localStorage.setItem("auth_booth_no", authBoothNo);
    localStorage.setItem("auth_exhibition_id", authExhibitionId);
    localStorage.setItem("auth_expo_id", authExpoId);
    localStorage.setItem("auth_agency_id", authAgencyId);
    localStorage.setItem("auth_tenant_id", authTenantId);
    localStorage.setItem("auth_param", authParam);
  }, [
    authPhone,
    authCompanyId,
    authBoothNo,
    authExhibitionId,
    authExpoId,
    authAgencyId,
    authTenantId,
    authParam,
  ]);

  // ---------- 右侧运行态 ----------
  const [status, setStatus] = useState<RunStatus>("idle");
  const [stageMsg, setStageMsg] = useState("");
  const [cases, setCases] = useState<NegativeTestCase[]>([]);
  const [results, setResults] = useState<CaseExecutionResult[]>([]);
  const [total, setTotal] = useState(0);
  const [markdownReport, setMarkdownReport] = useState("");
  const [reportFile, setReportFile] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "down">(
    "checking"
  );
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const runIdRef = useRef<string>("");
  const startAtRef = useRef<number>(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const apiFileRef = useRef<HTMLInputElement>(null);
  const prdFileRef = useRef<HTMLInputElement>(null);

  const deepseekConfig = {
    api_key: dsKey.trim() || undefined,
    model: dsModel.trim() || undefined,
    base_url: dsBase.trim() || undefined,
  };

  const compact = (obj: Record<string, string>) =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v));

  const authConfig = authPhone.trim()
    ? {
        login_path: "/login/syncLogin",
        method: "POST",
        body: compact({
          userPhone: authPhone.trim(),
          companyId: authCompanyId.trim(),
          boothNo: authBoothNo.trim(),
          exhibitionId: authExhibitionId.trim(),
          expoId: (authExpoId || authExhibitionId).trim(),
        }),
        param: authParam.trim() || undefined,
        exhibition_id: authExhibitionId.trim() || undefined,
        token_json_path: "$.token",
        header_name: "Authorization",
        header_prefix: "Bearer ",
        extra_headers: compact({
          "agency-id": authAgencyId.trim(),
          "tenant-id": authTenantId.trim(),
        }),
      }
    : undefined;

  // SSE：只接收本次 run_id 的事件
  useEffect(() => {
    const close = subscribeEvents((data) => {
      let evt: PipelineEvent;
      try {
        evt = JSON.parse(data) as PipelineEvent;
      } catch {
        return;
      }
      if (!evt.run_id || evt.run_id !== runIdRef.current) return;

      switch (evt.type) {
        case "stage":
          setStageMsg(evt.message || evt.stage || "");
          break;
        case "cases": {
          const list = (evt.payload as NegativeTestCase[]) || [];
          setCases((prev) => {
            if (!evt.partial) return list;
            const map = new Map(prev.map((c) => [c.case_id, c]));
            list.forEach((c) => map.set(c.case_id, c));
            return Array.from(map.values());
          });
          const totalSoFar = evt.partial
            ? evt.total_cases || list.length
            : list.length;
          setTotal(totalSoFar);
          setStageMsg(
            evt.partial
              ? `第 ${evt.batch}/${evt.batches} 批反例已生成（累计 ${totalSoFar} 个），继续生成…`
              : `已生成 ${list.length} 个反例，开始并发执行…`
          );
          break;
        }
        case "result": {
          const item = evt.payload as CaseExecutionResult;
          setResults((prev) => [...prev, item]);
          break;
        }
        case "report":
          setMarkdownReport(evt.markdown || "");
          setReportFile(evt.report_file || "");
          setStageMsg(
            `执行完成：${evt.total_cases} 个反例，通过 ${evt.passed}，失败 ${evt.failed}，通过率 ${evt.pass_rate}%`
          );
          setStatus("done");
          break;
        case "error":
          setStageMsg(evt.message || "执行失败");
          setStatus("error");
          break;
        default:
          break;
      }
    });
    return close;
  }, []);

  // 计时器
  useEffect(() => {
    if (status !== "running") return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [status]);

  // 结果自动滚动
  useEffect(() => {
    if (resultsRef.current) {
      resultsRef.current.scrollTop = resultsRef.current.scrollHeight;
    }
  }, [results]);

  // 报告浮层：ESC 关闭
  useEffect(() => {
    if (!showReport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowReport(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showReport]);

  // 启动时探活：连不上后端时直接给出可读提示，而不是只报 Failed to fetch
  const checkHealth = async () => {
    setApiStatus("checking");
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${API_BASE}/api/health`, {
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      setApiStatus(res.ok ? "ok" : "down");
    } catch {
      setApiStatus("down");
    }
  };
  useEffect(() => {
    checkHealth();
  }, []);

  const passed = useMemo(() => results.filter((r) => r.passed).length, [results]);
  const failed = results.length - passed;
  const finished = status === "done" || status === "error";

  /** 读取本地文件填入输入框 */
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

  const beginRun = () => {
    const rid = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    runIdRef.current = rid;
    startAtRef.current = Date.now();
    setCases([]);
    setResults([]);
    setTotal(0);
    setMarkdownReport("");
    setReportFile("");
    setElapsed(0);
    setStatus("running");
    setStageMsg("提交中…");
    return rid;
  };

  /** 首轮：生成反例 + 执行 */
  const handleInitAndRun = async () => {
    if (status === "running") return;
    const rid = beginRun();
    try {
      const data = await initAndRun({
        project_name: projectName,
        base_url: baseUrl,
        api_spec: apiSpec,
        prd_content: prdText,
        deepseek: deepseekConfig,
        auth: authConfig,
        run_id: rid,
      });
      // SSE 已经推过一遍，这里做兜底（比如 SSE 断开）
      if (!markdownReport) {
        setMarkdownReport(data.markdown_report);
        setReportFile(data.report_file || "");
      }
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setStageMsg(friendlyError(e));
    }
  };

  /** 追问：改流水线 + 重跑 */
  const handleSendFollowUp = async () => {
    if (!chatInput.trim() || status === "running") return;
    const instruction = chatInput;
    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", content: instruction }]);
    const rid = beginRun();
    try {
      const data = await chatRefine(instruction, deepseekConfig, rid);
      if (data.agent_reply) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.agent_reply as string },
        ]);
      }
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setStageMsg(friendlyError(e));
    }
  };

  /** 导出本地 Markdown */
  const handleDownloadMd = () => {
    if (!markdownReport) return;
    const blob = new Blob([markdownReport], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName}-反例测试报告.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 font-sans">
      {/* ============ 左：配置 ============ */}
      <div className="w-[24rem] shrink-0 border-r border-slate-200 p-4 flex flex-col gap-3 bg-white overflow-y-auto">
        <h2 className="text-base font-semibold text-slate-900">项目与文档配置</h2>

        <div>
          <label className="text-xs text-slate-500 block mb-1">项目名称</label>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 block mb-1">API Base URL</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com"
            className="w-full bg-white border border-slate-300 rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
        </div>

        {/* DeepSeek */}
        <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50/60">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-700 font-medium flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5 text-amber-500" /> DeepSeek 配置
            </span>
            <span className="text-[10px] text-slate-400">仅存本地</span>
          </div>
          <input
            type="password"
            value={dsKey}
            onChange={(e) => setDsKey(e.target.value)}
            placeholder="API Key（sk-...）"
            className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono"
          />
          <div className="flex gap-2">
            <select
              value={dsModel}
              onChange={(e) => setDsModel(e.target.value)}
              className="flex-1 bg-white border border-slate-300 rounded px-2 py-1 text-xs"
            >
              <option value="deepseek-chat">deepseek-chat</option>
              <option value="deepseek-reasoner">deepseek-reasoner</option>
            </select>
            <input
              value={dsBase}
              onChange={(e) => setDsBase(e.target.value)}
              placeholder="Base URL"
              className="flex-1 bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono"
            />
          </div>
        </div>

        {/* 登录前置 */}
        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-700 font-medium flex items-center gap-1">
              <LogIn className="w-3.5 h-3.5 text-emerald-600" /> 登录前置（可选）
            </span>
            <span className="text-[10px] text-slate-400">填手机号即启用</span>
          </div>
          <div className="mt-2 space-y-2">
            <input
              value={authParam}
              onChange={(e) => setAuthParam(e.target.value)}
              placeholder="CPS27 param（如 CPS27EFORM_320356_20261023183512_xxx）"
              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-[11px] font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input
              value={authPhone}
              onChange={(e) => setAuthPhone(e.target.value)}
              placeholder="userPhone *"
              className="bg-white border border-slate-300 rounded px-2 py-1 text-xs"
            />
            <input
              value={authBoothNo}
              onChange={(e) => setAuthBoothNo(e.target.value)}
              placeholder="boothNo"
              className="bg-white border border-slate-300 rounded px-2 py-1 text-xs"
            />
            <input
              value={authCompanyId}
              onChange={(e) => setAuthCompanyId(e.target.value)}
              placeholder="companyId"
              className="bg-white border border-slate-300 rounded px-2 py-1 text-xs"
            />
            <input
              value={authExhibitionId}
              onChange={(e) => setAuthExhibitionId(e.target.value)}
              placeholder="exhibitionId"
              className="bg-white border border-slate-300 rounded px-2 py-1 text-xs"
            />
            <input
              value={authAgencyId}
              onChange={(e) => setAuthAgencyId(e.target.value)}
              placeholder="agency-id"
              className="bg-white border border-slate-300 rounded px-2 py-1 text-xs"
            />
            <input
              value={authTenantId}
              onChange={(e) => setAuthTenantId(e.target.value)}
              placeholder="tenant-id"
              className="bg-white border border-slate-300 rounded px-2 py-1 text-xs"
            />
          </div>
          {authPhone.trim() ? (
            <p className="text-[10px] text-emerald-600 mt-1">
              先 GET /login/getBaseInfo?param=… 取展位信息，再 POST
              /login/syncLogin 取 $.token → 注入 Authorization: Bearer {"{{token}}"}
            </p>
          ) : (
            <p className="text-[10px] text-slate-400 mt-1">
              不填则首轮不带登录态（/home 类接口会返回 401）
            </p>
          )}
        </div>

        {/* 接口定义 */}
        <div className="flex-1 min-h-[170px] flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-slate-500 flex items-center gap-1">
              <Braces className="w-3.5 h-3.5" /> 接口定义 / API JSON
            </label>
            <div className="flex items-center gap-2">
              {importName && (
                <span className="text-[10px] text-slate-400 max-w-[8rem] truncate">
                  {importName}
                </span>
              )}
              <button
                onClick={() => apiFileRef.current?.click()}
                className="text-[11px] text-indigo-600 hover:text-indigo-500 flex items-center gap-1 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded"
              >
                <Upload className="w-3 h-3" /> 导入文件
              </button>
              <input
                ref={apiFileRef}
                type="file"
                accept=".json,.yaml,.yml,.md,.txt"
                onChange={(e) => readFileInto(e, setApiSpec)}
                className="hidden"
              />
            </div>
          </div>
          <textarea
            value={apiSpec}
            onChange={(e) => setApiSpec(e.target.value)}
            className="w-full flex-1 bg-white border border-slate-300 rounded-md p-3 text-xs leading-relaxed resize-none font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
        </div>

        {/* PRD */}
        <div className="flex-1 min-h-[130px] flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-slate-500">产品需求文档（PRD）</label>
            <button
              onClick={() => prdFileRef.current?.click()}
              className="text-[11px] text-slate-600 hover:text-slate-800 flex items-center gap-1 border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2 py-0.5 rounded"
            >
              <Upload className="w-3 h-3" /> 导入
            </button>
            <input
              ref={prdFileRef}
              type="file"
              accept=".md,.txt,.json,.yaml,.yml"
              onChange={(e) => readFileInto(e, setPrdText)}
              className="hidden"
            />
          </div>
          <textarea
            value={prdText}
            onChange={(e) => setPrdText(e.target.value)}
            className="w-full flex-1 bg-white border border-slate-300 rounded-md p-3 text-xs leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
        </div>

        <button
          onClick={handleInitAndRun}
          disabled={status === "running"}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2 rounded-md flex items-center justify-center gap-2 text-sm shadow-sm"
        >
          {status === "running" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          {status === "running" ? "运行中…" : "开始生成并执行反例"}
        </button>
      </div>

      {/* ============ 右：流式输出 ============ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 状态条 */}
        <div className="px-5 py-3 border-b border-slate-200 bg-white flex items-center justify-between gap-4">
          <div className="min-w-0 flex items-center gap-3">
            <StatusDot status={status} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">
                {statusText(status, stageMsg)}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <StatTag label="耗时" value={`${elapsed}s`} tone="slate">
                  <Clock className="w-3 h-3" />
                </StatTag>
                <StatTag label="反例" value={total || cases.length} tone="indigo" />
                <StatTag
                  label="已完成"
                  value={`${results.length}${total ? `/${total}` : ""}`}
                  tone="amber"
                />
                <StatTag label="通过" value={passed} tone="emerald" />
                <StatTag label="失败" value={failed} tone="rose" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowReport(true)}
              disabled={!markdownReport}
              className="bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-slate-300"
              title={markdownReport ? "在线预览报告" : "尚未生成报告"}
            >
              <FileText className="w-3.5 h-3.5" /> MD 报告
            </button>
            <button
              onClick={handleDownloadMd}
              disabled={!markdownReport}
              className="bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-slate-300"
            >
              <FileDown className="w-3.5 h-3.5" /> 导出 .MD
            </button>
            <button
              onClick={() =>
                window.open(`${API_BASE}/api/pipeline/report/download`, "_blank")
              }
              disabled={!reportFile}
              className="bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-slate-300"
              title={reportFile || "尚未生成报告文件"}
            >
              <FileDown className="w-3.5 h-3.5" /> 报告文件
            </button>
          </div>
        </div>

        {/* 后端连不上时的提示条 */}
        {apiStatus === "down" && (
          <div className="px-5 py-2 bg-rose-50 border-b border-rose-200 text-[12px] text-rose-700 flex items-center justify-between gap-3">
            <span className="truncate">
              无法连接后端 <code className="font-mono">{API_BASE}</code>：请先启动
              后端（<code className="font-mono">cd bls-testS/backend && cargo run</code>
              ），或检查端口占用 / 代理。
            </span>
            <button
              onClick={checkHealth}
              className="shrink-0 px-2.5 py-1 rounded border border-rose-300 bg-white hover:bg-rose-100 text-rose-700"
            >
              重试
            </button>
          </div>
        )}

        {/* 内容：流式区常驻，报告以浮层覆盖 */}
        <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0 overflow-y-auto p-5 space-y-4">
              {/* 反例清单 */}
              <section>
                <SectionTitle
                  title="① 生成的反例用例"
                  count={cases.length}
                  hint={cases.length === 0 ? "等待 DeepSeek 输出…" : undefined}
                />
                {cases.length === 0 ? (
                  <Skeleton lines={3} />
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {cases.map((c, idx) => (
                      <div
                        key={`${c.case_id || idx}`}
                        className="bg-white border border-slate-200 rounded-md px-3 py-2 text-xs flex items-start gap-2"
                      >
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] ${
                            CATEGORY_STYLE[c.category] ||
                            "bg-slate-100 text-slate-600 border-slate-300"
                          }`}
                        >
                          {c.category || "CASE"}
                        </span>
                        <div className="min-w-0">
                          <div className="text-slate-800 truncate">{c.title}</div>
                          <div className="text-[11px] text-slate-400 font-mono truncate">
                            {c.method} {c.path}
                            {c.expected_status_codes?.length
                              ? ` → ${c.expected_status_codes.join("/")}`
                              : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 执行结果 */}
              <section>
                <SectionTitle
                  title="② 测试执行结果"
                  count={results.length}
                  hint={
                    status === "running" && results.length < cases.length
                      ? `执行中 ${results.length}/${cases.length}`
                      : undefined
                  }
                />
                <div
                  ref={resultsRef}
                  className="bg-white border border-slate-200 rounded-lg max-h-[46vh] overflow-y-auto divide-y divide-slate-100"
                >
                  {results.length === 0 ? (
                    <div className="p-4 text-xs text-slate-400">
                      {status === "running"
                        ? "等待首个反例返回…"
                        : "执行结果会在这里实时出现。"}
                    </div>
                  ) : (
                    results.map((r, idx) => (
                      <div
                        key={`${r.case_id}-${idx}`}
                        className="px-3 py-2 text-xs flex items-center gap-3"
                      >
                        {r.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                        )}
                        <span className="font-mono text-slate-400 w-14 shrink-0">
                          {r.case_id || "-"}
                        </span>
                        <span className="text-slate-800 min-w-0 flex-1 truncate">
                          {r.title}
                        </span>
                        <span className="font-mono text-slate-500 shrink-0">
                          {r.actual_status || "ERR"}
                          <span className="text-slate-300"> / </span>
                          <span className="text-slate-400">
                            {r.expected_status_codes?.join(",") || "4xx"}
                          </span>
                        </span>
                        <span className="text-slate-400 w-14 text-right shrink-0">
                          {r.duration_ms}ms
                        </span>
                        {!r.passed && (
                          <span
                            className="text-[10px] text-rose-500 max-w-[16rem] truncate"
                            title={r.failure_reason || ""}
                          >
                            {r.failure_reason}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>
          </div>

          {/* 报告在线预览：盖住流式区，右上角关闭 */}
          {showReport && (
            <div className="absolute inset-0 bg-white z-20 flex flex-col shadow-inner">
              <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">Markdown 报告预览</div>
                  {reportFile && (
                    <div className="text-[11px] text-slate-400 font-mono truncate">{reportFile}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleDownloadMd}
                    disabled={!markdownReport}
                    className="bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-slate-300"
                  >
                    <FileDown className="w-3.5 h-3.5" /> 导出 .MD
                  </button>
                  <button
                    onClick={() => window.open(`${API_BASE}/api/pipeline/report/download`, "_blank")}
                    disabled={!reportFile}
                    className="bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-slate-300"
                  >
                    <FileDown className="w-3.5 h-3.5" /> 报告文件
                  </button>
                  <button
                    onClick={() => setShowReport(false)}
                    className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" /> 关闭
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 prose prose-slate max-w-none text-sm">
                <ReactMarkdown>{markdownReport}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* 追问栏 */}
        <div className="border-t border-slate-200 bg-white p-3 flex items-center gap-2">
          <span className="text-[11px] text-slate-400 shrink-0">追问</span>
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendFollowUp()}
            placeholder="如：这些接口需要先登录再测试，登录 POST /login/syncLogin，提取 $.token…"
            className="flex-1 bg-white border border-slate-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          />
          <button
            onClick={handleSendFollowUp}
            disabled={status === "running" || !finished}
            className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 px-3 py-2 rounded-md text-white"
            title={finished ? "按该指令调整流水线并重跑" : "先跑完首轮"}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

type TagTone = "slate" | "indigo" | "amber" | "emerald" | "rose";

const TAG_TONE: Record<TagTone, string> = {
  slate: "bg-white text-slate-500 border-slate-200",
  indigo: "bg-indigo-50 text-indigo-600 border-indigo-200",
  amber: "bg-amber-50 text-amber-600 border-amber-200",
  emerald: "bg-emerald-50 text-emerald-600 border-emerald-200",
  rose: "bg-rose-50 text-rose-600 border-rose-200",
};

function StatTag({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: React.ReactNode;
  tone: TagTone;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] ${TAG_TONE[tone]}`}
    >
      {children}
      <span className="opacity-60">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function friendlyError(e: unknown) {
  const msg = (e as Error)?.message || String(e);
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return `无法连接后端（${API_BASE}），请确认已运行 cargo run 且 8080 端口未被占用。`;
  }
  return msg;
}

function StatusDot({ status }: { status: RunStatus }) {
  const color =
    status === "running"
      ? "bg-amber-400 animate-pulse"
      : status === "done"
      ? "bg-emerald-500"
      : status === "error"
      ? "bg-rose-500"
      : "bg-slate-300";
  return <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />;
}

function statusText(status: RunStatus, stageMsg: string) {
  if (status === "running") return stageMsg || "运行中…";
  if (status === "done") return stageMsg || "执行完成";
  if (status === "error") return stageMsg || "执行失败";
  return "就绪：配置接口文档后开始";
}

function SectionTitle({
  title,
  count,
  hint,
}: {
  title: string;
  count: number;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="text-sm font-medium text-slate-800">
        {title}
        <span className="ml-1.5 text-xs text-slate-400">{count}</span>
      </div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-8 bg-slate-100 rounded-md animate-pulse"
          style={{ width: `${92 - i * 8}%` }}
        />
      ))}
    </div>
  );
}
