// 值标签栏 + 当前标签的值面板（多 key 并行查看，参考主流 Redis GUI 的标签页）。
// 点 key 开标签（已开则聚焦）、可关、可切换；每个标签独立持 detail（类型+TTL+值）与自动刷新。
import { Loader2, X } from "lucide-react";
import type { WriteOp } from "../types";
import type { ValueTab } from "../hooks/useValueTabs";
import { ValuePanel } from "./value/ValuePanel";
import { typeDotClass } from "./ui";
import { useT } from "../i18n";

interface Props {
  tabs: ValueTab[];
  activeKey: string | null;
  setActive: (key: string) => void;
  closeTab: (key: string) => void;
  closeAll: () => void;
  refresh: (key: string) => void;
  nextPage: (key: string) => void;
  prevPage: (key: string) => void;
  gotoPage: (key: string, n: number) => void;
  write: (key: string, op: WriteOp) => Promise<void>;
  setTtl: (key: string, ttl: number | null) => Promise<void>;
  deleteKey: (key: string) => Promise<void>;
  setAuto: (key: string, on: boolean) => void;
  setIntervalSecs: (key: string, n: number) => void;
}

export function ValueTabs(props: Props) {
  const { tabs, activeKey, setActive, closeTab, closeAll } = props;
  const { t } = useT();
  const active = tabs.find((tab) => tab.key === activeKey) ?? null;

  if (tabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-neutral-600">
        {t("点击左侧 key 查看值（可多开标签对比）")}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      {/* 标签栏 */}
      <div className="flex items-stretch border-b border-neutral-800 bg-neutral-900">
        <div className="flex flex-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.key === activeKey;
            const color = typeDotClass(tab.detail?.type ?? "unknown");
            return (
              <div
                key={tab.key}
                onClick={() => setActive(tab.key)}
                className={`group flex max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-neutral-800 px-3 py-1.5 text-xs ${
                  isActive
                    ? "bg-neutral-950 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-800/60"
                }`}
                title={tab.key}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
                <span className="min-w-0 flex-1 truncate">{tab.key}</span>
                {tab.loading && (
                  <Loader2 size={10} className="shrink-0 animate-spin text-neutral-500" />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.key);
                  }}
                  className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100"
                  title={t("关闭标签")}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={closeAll}
          className="shrink-0 px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-200"
          title={t("关闭全部")}
        >
          {t("关闭全部")}
        </button>
      </div>

      {/* 当前标签的值面板 */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {active && (
          <ValuePanel
            key={active.key}
            selectedKey={active.key}
            type={active.detail?.type ?? "unknown"}
            ttl={active.detail?.ttl ?? null}
            loading={active.loading}
            error={active.error}
            value={active.detail?.value ?? null}
            onWrite={(op) => props.write(active.key, op)}
            onSetTtl={(ttl) => props.setTtl(active.key, ttl)}
            onDelete={() => props.deleteKey(active.key)}
            onRefresh={() => props.refresh(active.key)}
            refreshing={active.refreshing}
            writing={active.writing}
            auto={active.auto}
            interval={active.interval}
            onAutoChange={(on) => props.setAuto(active.key, on)}
            onIntervalChange={(n) => props.setIntervalSecs(active.key, n)}
            total={active.detail?.total ?? null}
            pagePos={active.pagePos}
            nextPos={active.nextPos}
            hasPrev={active.prevStack.length > 0}
            onPrev={() => props.prevPage(active.key)}
            onNext={() => props.nextPage(active.key)}
            onGoto={(n) => props.gotoPage(active.key, n)}
          />
        )}
      </div>
    </div>
  );
}
