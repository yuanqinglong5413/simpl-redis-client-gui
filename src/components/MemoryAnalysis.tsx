// 内存分析：扫描当前 db，列出占用最大的 key + 总量。参考 RedisInsight Memory Analysis。
import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { ipc } from "../lib/ipc";
import { fmtBytes } from "../lib/format";
import { StatCard, Toolbar } from "./ui";
import { useT } from "../i18n";
import type { MemAnalysis } from "../types";

const TOP_LIMIT = 100;

export function MemoryAnalysis({ activeId }: { activeId: string }) {
  const { t } = useT();
  const [result, setResult] = useState<MemAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await ipc.analyzeMemory(activeId, TOP_LIMIT));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const maxBytes = result?.top[0]?.bytes ?? 0;

  return (
    <div className="flex h-full flex-col">
      <Toolbar className="gap-3">
        <button
          onClick={() => void run()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {loading ? t("分析中…") : result ? t("重新分析") : t("开始分析")}
        </button>
        <span className="text-xs text-neutral-500">
          {t("扫描当前 db 全部 key 计算占用，大库可能较慢")}
        </span>
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {result && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <StatCard label={t("Key 总数")} value={String(result.total_keys)} />
              <StatCard label={t("总占用")} value={fmtBytes(result.total_bytes)} />
            </div>
            {result.top.length === 0 ? (
              <p className="text-xs text-neutral-500">{t("当前 db 无 key")}</p>
            ) : (
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-500">
                    <th className="w-10 px-2 py-1">#</th>
                    <th className="px-2 py-1">Key</th>
                    <th className="w-16 px-2 py-1">{t("类型")}</th>
                    <th className="w-44 px-2 py-1">{t("占用")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.top.map((k, i) => (
                    <tr key={k.key} className="border-b border-neutral-800/60 align-middle">
                      <td className="px-2 py-1 text-neutral-600">{i + 1}</td>
                      <td className="truncate px-2 py-1 text-neutral-100" title={k.key}>
                        {k.key}
                      </td>
                      <td className="px-2 py-1 text-xs text-sky-400">{k.type}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded bg-neutral-800">
                            <div
                              className="h-full bg-red-600"
                              style={{
                                width: `${maxBytes ? (k.bytes / maxBytes) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <span className="w-16 shrink-0 text-right text-xs text-neutral-400">
                            {fmtBytes(k.bytes)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        {!result && !error && !loading && (
          <p className="text-xs text-neutral-600">
            {t("点击「开始分析」扫描当前 db，定位占用最大的 key。")}
          </p>
        )}
      </div>
    </div>
  );
}
