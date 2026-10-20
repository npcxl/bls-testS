import { KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

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
    <main className="flex-1 overflow-y-auto p-6 bg-[#F8FAFC]">
      <div className="max-w-3xl mx-auto space-y-4">
        <h2 className="text-lg font-semibold">设置</h2>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <KeyRound className="h-4 w-4" /> DeepSeek
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => onApiKey(e.target.value)}
                placeholder="sk-..."
                className="font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>模型</Label>
                <select
                  value={model}
                  onChange={(e) => onModel(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs"
                >
                  <option value="deepseek-chat">deepseek-chat</option>
                  <option value="deepseek-reasoner">deepseek-reasoner</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Base URL</Label>
                <Input
                  value={baseUrl}
                  onChange={(e) => onBaseUrl(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>本地数据</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              配置、任务、反例与报告保存在本机浏览器（最多 30 个任务 / 50 个配置）。
            </p>
            <Button variant="destructive" onClick={onClearAll}>
              清空本机数据
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
