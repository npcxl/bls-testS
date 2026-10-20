import { useEffect, useState } from "react";
import type { TestConfig } from "../types/pipeline";
import type { ConfigBuffer } from "../types/ui";
import { EMPTY_LOGIN, SAMPLE_API_SPEC, SAMPLE_PRD } from "../lib/constants";

const DEFAULT_BUFFER: ConfigBuffer = {
  projectName: "橡塑展",
  baseUrl: "http://10.12.1.25:48997",
  apiSpec: SAMPLE_API_SPEC,
  prdText: SAMPLE_PRD,
  authMode: "none",
  cookie: "",
  login: { ...EMPTY_LOGIN },
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
  };
}
