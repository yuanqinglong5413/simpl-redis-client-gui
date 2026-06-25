// 底部状态栏：模式 · db · key 数（dbsize）· 延迟（往返 ms）。每 5 秒刷新一次。
// 用一次 dbsize 往返同时拿到 key 数与延迟。
import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import { useT } from "../i18n";
import type { ServerInfo } from "../types";

interface Props {
  activeId: string;
  db: number;
  serverInfo: ServerInfo | null;
}

export function StatusBar({ activeId, db, serverInfo }: Props) {
  const { t } = useT();
  const [keys, setKeys] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      const t0 = performance.now();
      try {
        const n = await ipc.dbsize(activeId);
        if (cancelled) return;
        setKeys(n);
        setLatency(Math.round(performance.now() - t0));
        setErr(null);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
          setLatency(null);
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, 5000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeId, db]);

  return (
    <div className="flex shrink-0 items-center gap-4 border-t border-neutral-800 bg-neutral-900 px-4 py-1 text-[11px] text-neutral-400">
      <span className="text-neutral-300">{serverInfo?.mode ?? "standalone"}</span>
      {serverInfo?.version && (
        <span className="text-neutral-500">v{serverInfo.version}</span>
      )}
      <span>db {db}</span>
      <span>keys {keys ?? (err ? "—" : "…")}</span>
      <span>{t("延迟")} {latency == null ? "—" : `${latency}ms`}</span>
      {err && <span className="truncate text-red-400">{err}</span>}
    </div>
  );
}
