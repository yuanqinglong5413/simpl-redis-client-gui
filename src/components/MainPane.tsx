// 右侧主区：连接信息条 + Keys/CLI 标签 + 底部状态栏。
// 扁平化：不再用圆角边框包裹 tab 内容（避免与各面板自身工具栏形成同心套框）；
// 版本/模式不再占用顶部卡片，版本并入 StatusBar（模式本就在）。
import { lazy, Suspense, type ReactNode } from "react";
import { Loader2, PlugZap, RefreshCw } from "lucide-react";
import { useConnections } from "../hooks/useConnections";
import { useActiveEnv } from "../lib/env";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useT } from "../i18n";
import { EmptyState } from "./EmptyState";
import { KeyBrowser } from "./KeyBrowser";
import { MemoryAnalysis } from "./MemoryAnalysis";
import { PubSubPanel } from "./PubSubPanel";
import { ServerMonitor } from "./ServerMonitor";
import { StatusBar } from "./StatusBar";

// 懒加载：xterm 较大（~370KB），仅在打开 CLI 标签时加载，保持首屏轻量。
const CliTerminal = lazy(() =>
  import("./cli/CliTerminal").then((m) => ({ default: m.CliTerminal })),
);

export function MainPane() {
  const { configs, activeId, serverInfo, status, error, health, connect, disconnect, db } =
    useConnections();
  const activeEnv = useActiveEnv();
  const { t } = useT();
  // 当前主标签刷新后保留。
  const [tab, setTab] = useLocalStorage<"keys" | "memory" | "server" | "pubsub" | "cli">(
    "rc:mainTab",
    "keys",
  );

  const active = configs.find((c) => c.id === activeId) ?? null;

  if (!active) {
    return (
      <main className="flex-1 bg-neutral-950">
        <EmptyState title={t("未选择连接")} hint={t("从左侧选择一个连接，或点击 + 新建")} />
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-neutral-950">
      {/* 连接条：纤细的「你在这里」锚点 + 断开/重试 */}
      <div
        className={`flex items-center justify-between border-b px-4 py-2 ${
          activeEnv === "prod" ? "border-red-900/60 bg-red-950/20" : "border-neutral-800"
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-neutral-100">
            <span className="truncate">{active.name || t("(未命名)")}</span>
            {activeEnv === "prod" && (
              <span className="shrink-0 rounded bg-red-600/25 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-red-300">
                PROD
              </span>
            )}
          </div>
          <div className="truncate text-xs text-neutral-500">
            {active.host}:{active.port}/{db}
            {active.tls ? " · TLS" : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === "connected" && (
            <button
              onClick={disconnect}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              <PlugZap size={14} /> {t("断开")}
            </button>
          )}
          {status === "error" && (
            <button
              onClick={() => connect(active.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              <RefreshCw size={14} /> {t("重试")}
            </button>
          )}
        </div>
      </div>

      {/* 连接中断/重连中：非阻断横条（fred 自动重连，恢复后自动消失） */}
      {status === "connected" && (health === "down" || health === "reconnecting") && (
        <div className="flex items-center gap-2 border-b border-amber-900/40 bg-amber-950/40 px-4 py-1.5 text-xs text-amber-300">
          <Loader2 size={13} className="animate-spin" />
          {health === "down" ? t("连接已断开，正在重连…") : t("连接不稳定，正在重连…")}
        </div>
      )}

      {/* 标签行 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-800 px-4">
        <TabButton active={tab === "keys"} onClick={() => setTab("keys")}>
          Keys
        </TabButton>
        <TabButton active={tab === "memory"} onClick={() => setTab("memory")}>
          {t("内存")}
        </TabButton>
        <TabButton active={tab === "server"} onClick={() => setTab("server")}>
          {t("监控")}
        </TabButton>
        <TabButton active={tab === "pubsub"} onClick={() => setTab("pubsub")}>
          Pub/Sub
        </TabButton>
        <TabButton active={tab === "cli"} onClick={() => setTab("cli")}>
          CLI
        </TabButton>
      </div>

      {/* 内容区：各面板 flush 填充，不再套圆角边框（避免同心框） */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {status === "connecting" && (
          <div className="flex items-center gap-2 p-4 text-neutral-400">
            <Loader2 size={16} className="animate-spin" /> {t("正在连接…")}
          </div>
        )}

        {status === "error" && error && (
          <div className="m-4 rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {status === "connected" && serverInfo && (
          <>
            {tab === "keys" ? (
              // key={activeId}：换连接时强制重挂，让默认视图/自动刷新按新连接偏好重置，useKeys 也整体刷新。
              <KeyBrowser key={activeId} />
            ) : tab === "memory" ? (
              <MemoryAnalysis key={activeId} activeId={active.id} />
            ) : tab === "server" ? (
              <ServerMonitor key={activeId} activeId={active.id} />
            ) : tab === "pubsub" ? (
              <PubSubPanel key={activeId} activeId={active.id} />
            ) : (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                    {t("加载终端…")}
                  </div>
                }
              >
                <CliTerminal
                  activeId={active.id}
                  prompt={`${active.host}:${active.port}[${db}]> `}
                  isProd={activeEnv === "prod"}
                />
              </Suspense>
            )}
          </>
        )}
      </div>

      {status === "connected" && activeId && (
        <StatusBar activeId={activeId} db={db} serverInfo={serverInfo} />
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-t-lg border-b-2 px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-red-600 text-neutral-100"
          : "border-transparent text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}
