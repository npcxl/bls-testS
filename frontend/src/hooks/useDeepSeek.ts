import { useEffect, useState } from "react";
import type { DeepSeekSettings } from "../types/ui";

/** DeepSeek 配置（全局，存 localStorage） */
export function useDeepSeek() {
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem("ds_api_key") || ""
  );
  const [model, setModel] = useState<string>(
    () => localStorage.getItem("ds_model") || "deepseek-chat"
  );
  const [baseUrl, setBaseUrl] = useState<string>(
    () => localStorage.getItem("ds_base_url") || "https://api.deepseek.com"
  );

  useEffect(() => {
    localStorage.setItem("ds_api_key", apiKey);
    localStorage.setItem("ds_model", model);
    localStorage.setItem("ds_base_url", baseUrl);
  }, [apiKey, model, baseUrl]);

  const settings: DeepSeekSettings = {
    api_key: apiKey.trim() || undefined,
    model: model.trim() || undefined,
    base_url: baseUrl.trim() || undefined,
  };

  return {
    apiKey,
    setApiKey,
    model,
    setModel,
    baseUrl,
    setBaseUrl,
    settings,
  };
}
