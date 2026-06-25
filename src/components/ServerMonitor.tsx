// 服务器监控：实时 INFO 指标（内存/连接/ops/命中率/各 db key 数）+ 慢日志。
// 参考 RedisInsight 的 Performance / Slowlog。
import { useCallback, useState } from "react";
import { ipc } from "../lib/ipc";
import { fmtBytes } from "../lib/format";
import { useInterval } from "../hooks/useInterval";
import { RefreshControls, StatCard, Toolbar } from "./ui";
import { useT } from "../i18n";
import type { ServerStats, SlowEntry } from "../types";

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ServerMonitor({ activeId }: { activeId: string }) {
  const { t } = useT();
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [slow, setSlow] = useState<SlowEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [interval, setIntervalSecs] = useState(3);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, sl] = await Promise.all([
        ipc.serverStats(activeId),
        ipc.slowlog(activeId, 50),
      ]);
      setStats(s);
      setSlow(sl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  // 自动刷新：useInterval 读最新回调；auto 关或暂停时不启动。
  useInterval(() => void fetchAll(), auto && interval >= 1 ? interval * 1000 : null);

  const hitRate =
    stats && stats.keyspace_hits + stats.keyspace_misses > 0
      ? (stats.keyspace_hits / (stats.keyspace_hits + stats.keyspace_misses)) * 100
      : null;

  return (
    <div className="flex h-full flex-col">
      <Toolbar className="gap-3">
        <span className="text-sm text-neutral-300">{t("服务器监控")}</span>
        <div className="ml-auto">
          <RefreshControls
            auto={auto}
            interval={interval}
            onAutoChange={setAuto}
            onIntervalChange={setIntervalSecs}
            onRefresh={() => void fetchAll()}
            refreshing={loading}
          />
        </div>
      </Toolbar>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && (
          <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {stats && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                label={t("已用内存")}
                value={fmtBytes(stats.used_memory_bytes)}
                sub={t("峰值 {x}", { x: fmtBytes(stats.used_memory_peak_bytes) })}
              />
              <StatCard label={t("连接客户端")} value={String(stats.connected_clients)} />
              <StatCard label={t("ops/秒")} value={String(stats.ops_per_sec)} />
              <StatCard
                label={t("命中率")}
                value={hitRate == null ? "—" : `${hitRate.toFixed(1)}%`}
              />
              <StatCard label={t("运行时长")} value={fmtUptime(stats.uptime_secs)} />
              <StatCard label={t("累计命令")} value={stats.total_commands.toLocaleString()} />
              <StatCard
                label={t("命中/未命中")}
                value={`${stats.keyspace_hits} / ${stats.keyspace_misses}`}
              />
              <StatCard
                label={t("各 db key 数")}
                value={
                  stats.db_key_counts.map(([d, n]) => `${d}:${n}`).join(" · ") ||
                  "—"
                }
              />
            </div>

            <div className="mb-2 text-xs font-medium text-neutral-400">
              {t("慢日志（最近 50）")}
            </div>
            {slow.length === 0 ? (
              <p className="text-xs text-neutral-600">{t("无慢日志")}</p>
            ) : (
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-500">
                    <th className="w-20 px-2 py-1">{t("耗时")}</th>
                    <th className="px-2 py-1">{t("命令")}</th>
                    <th className="w-44 px-2 py-1">{t("客户端")}</th>
                  </tr>
                </thead>
                <tbody>
                  {slow.map((e) => (
                    <tr key={e.id} className="border-b border-neutral-800/60 align-top">
                      <td className="px-2 py-1 text-xs text-amber-400">
                        {(e.duration_us / 1000).toFixed(2)}ms
                      </td>
                      <td className="truncate px-2 py-1 text-neutral-200" title={e.command}>
                        {e.command}
                      </td>
                      <td className="truncate px-2 py-1 text-xs text-neutral-500" title={e.client}>
                        {e.client}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        {!stats && !error && <p className="text-xs text-neutral-600">{t("加载中…")}</p>}
      </div>
    </div>
  );
}
