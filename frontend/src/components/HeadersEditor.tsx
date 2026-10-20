import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface Row {
  k: string;
  v: string;
}

function toRows(headers: Record<string, string>): Row[] {
  return Object.entries(headers || {}).map(([k, v]) => ({ k, v }));
}

function toObject(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  rows.forEach(({ k, v }) => {
    const key = k.trim();
    if (key) out[key] = v;
  });
  return out;
}

/** 全局请求头编辑器：配置后所有接口都会带上 */
export function HeadersEditor({
  headers,
  onChange,
}: {
  headers: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState<Row[]>(toRows(headers));
  const lastEmitted = useRef(JSON.stringify(headers));

  // 外部（切换任务/配置）变化时同步
  useEffect(() => {
    const incoming = JSON.stringify(headers || {});
    if (incoming !== lastEmitted.current) {
      setRows(toRows(headers));
      lastEmitted.current = incoming;
    }
  }, [headers]);

  const commit = (next: Row[]) => {
    setRows(next);
    const obj = toObject(next);
    lastEmitted.current = JSON.stringify(obj);
    onChange(obj);
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <div className="text-[11px] text-muted-foreground">
          还没有请求头，点下方「添加请求头」
        </div>
      )}
      {rows.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Input
            value={row.k}
            placeholder="Header 名，如 X-Tenant-Id"
            onChange={(e) => {
              const next = [...rows];
              next[idx] = { ...next[idx], k: e.target.value };
              commit(next);
            }}
            className="flex-1 font-mono"
          />
          <Input
            value={row.v}
            placeholder="值，如 358"
            onChange={(e) => {
              const next = [...rows];
              next[idx] = { ...next[idx], v: e.target.value };
              commit(next);
            }}
            className="flex-1 font-mono"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => commit(rows.filter((_, i) => i !== idx))}
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setRows([...rows, { k: "", v: "" }])}
      >
        <Plus className="w-3 h-3" /> 添加请求头
      </Button>
    </div>
  );
}
