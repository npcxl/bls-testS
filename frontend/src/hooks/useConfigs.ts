import { useEffect, useRef, useState } from "react";
import type { TestConfig } from "../types/pipeline";
import type { ConfigBuffer } from "../types/ui";
import { EMPTY_LOGIN, SAMPLE_API_SPEC, SAMPLE_PRD } from "../lib/constants";
import { getStore, putStore } from "../services/api";

const DEFAULT_BUFFER: ConfigBuffer = {
  projectName: "橡塑展",
  baseUrl: "http://10.12.1.25:48997",
  apiSpec: SAMPLE_API_SPEC,
  prdText: SAMPLE_PRD,
  authMode: "none",
  cookie: "",
  login: { ...EMPTY_LOGIN },
  headers: { "Content-Type": "application/json" },
};

function readConfigs(): TestConfig[] {
  try {
    return JSON.parse(localStorage.getItem("configs") || "[]") as TestConfig[];
  } catch {
    return [];
  }
}

function persistConfigs(next: TestConfig[]) {
  try {
    localStorage.setItem("configs", JSON.stringify(next));
  } catch {
    /* 超出配额忽略 */
  }
}

/** 配置档案（可复用），附带当前编辑缓冲区 */
export function useConfigs() {
  const [configs, setConfigs] = useState<TestConfig[]>(readConfigs);
  const [activeConfigId, setActiveConfigId] = useState("");
  const [buffer, setBuffer] = useState<ConfigBuffer>({ ...DEFAULT_BUFFER });

  // 本地数据库（后端 SQLite）：启动时以数据库为准
  const hydrated = useRef(false);
  useEffect(() => {
    (async () => {
      const remote = await getStore<TestConfig[]>("configs");
      if (Array.isArray(remote) && remote.length > 0) {
        setConfigs(remote);
        persistConfigs(remote);
        setActiveConfigId(remote[0].id);
        loadConfig(remote[0]);
      } else if (configs.length > 0) {
        void putStore("configs", configs).catch(() => {});
      }
      hydrated.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 变更后自动落库（防抖 600ms）
  useEffect(() => {
    if (!hydrated.current) return;
    const timer = window.setTimeout(() => {
      void putStore("configs", configs).catch(() => {});
    }, 600);
    return () => window.clearTimeout(timer);
  }, [configs]);

  /** 立即落库（手动保存用） */
  const flushConfigs = async () => {
    await putStore("configs", configs).catch(() => {});
  };

  const activeConfig = configs.find((c) => c.id === activeConfigId);

  const loadConfig = (cfg: TestConfig) => {
    setBuffer({
      projectName: cfg.projectName || "",
      baseUrl: cfg.baseUrl || "",
      apiSpec: cfg.apiSpec || "",
      prdText: cfg.prdText || "",
      authMode: cfg.authMode || "none",
      cookie: cfg.cookie || "",
      login: { ...EMPTY_LOGIN, ...(cfg.login || {}) },
      headers: cfg.headers || DEFAULT_BUFFER.headers,
    });
  };

  const selectConfig = (cfg: TestConfig) => {
    saveActiveConfig();
    setActiveConfigId(cfg.id);
    loadConfig(cfg);
  };

  const patchBuffer = (patch: Partial<ConfigBuffer>) =>
    setBuffer((b) => ({ ...b, ...patch }));

  const saveConfigs = (next: TestConfig[]) => {
    setConfigs(next);
    persistConfigs(next);
  };

  function saveActiveConfig(id = activeConfigId, override?: Partial<ConfigBuffer>) {
    if (!id) return;
    const payload = { ...buffer, ...(override || {}) };
    setConfigs((prev) => {
      const next = prev.map((c) =>
        c.id === id
          ? {
              ...c,
              ...payload,
              name: payload.projectName.trim() || c.name,
              updatedAt: new Date().toLocaleString(),
            }
          : c
      );
      persistConfigs(next);
      return next;
    });
  }

  const createConfig = () => {
    saveActiveConfig();
    const cfg: TestConfig = {
      id: `cfg-${Date.now()}`,
      name: `新配置 ${configs.length + 1}`,
      updatedAt: new Date().toLocaleString(),
      projectName: `新配置 ${configs.length + 1}`,
      baseUrl: "",
      apiSpec: "",
      prdText: "",
      authMode: "none",
      cookie: "",
      login: { ...EMPTY_LOGIN },
      headers: { "Content-Type": "application/json" },
    };
    saveConfigs([cfg, ...configs].slice(0, 50));
    setActiveConfigId(cfg.id);
    loadConfig(cfg);
    return cfg;
  };

  const deleteConfig = (id: string) => {
    const next = configs.filter((c) => c.id !== id);
    saveConfigs(next);
    if (activeConfigId === id) {
      const fallback = next[0];
      setActiveConfigId(fallback?.id || "");
      if (fallback) loadConfig(fallback);
    }
  };

  // 首次进入：默认选中第一个配置
  useEffect(() => {
    if (activeConfigId || configs.length === 0) return;
    setActiveConfigId(configs[0].id);
    loadConfig(configs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs.length]);

  return {
    configs,
    activeConfigId,
    activeConfig,
    buffer,
    patchBuffer,
    loadConfig,
    selectConfig,
    saveActiveConfig,
    createConfig,
    deleteConfig,
    setActiveConfigId,
    setBuffer,
    flushConfigs,
  };
}
