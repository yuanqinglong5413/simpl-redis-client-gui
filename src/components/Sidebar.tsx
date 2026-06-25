// 左侧栏：连接列表（按分组）+ 新建/编辑/删除/连接/断开。可折叠为图标轨（状态持久化）。
import { useMemo, useState } from "react";
import {
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  PlugZap,
  Server,
  Settings,
  Trash2,
} from "lucide-react";
import type { ConnectionConfig } from "../types";
import { useConnections, type ConnStatus } from "../hooks/useConnections";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useT } from "../i18n";

interface Props {
  onNew: () => void;
  onEdit: (config: ConnectionConfig) => void;
  onSettings: () => void;
}

export function Sidebar({ onNew, onEdit, onSettings }: Props) {
  const { configs, activeId, status, connect, disconnect, remove } = useConnections();
  const { t, locale, setLocale } = useT();
  // 折叠态持久化：w-64 ↔ w-14 图标轨。
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(
    "rc:sidebarCollapsed",
    false,
  );
  const toggleLocale = () => setLocale(locale === "zh" ? "en" : "zh");

  // 按 group 分组（null → "默认"），保持插入顺序
  const groups = useMemo(() => {
    const map = new Map<string, ConnectionConfig[]>();
    for (const c of configs) {
      const g = c.group ?? t("默认");
      const arr = map.get(g) ?? [];
      arr.push(c);
      map.set(g, arr);
    }
    return Array.from(map.entries());
  }, [configs, t]);

  return (
    <aside
      className={`flex h-full flex-col border-r border-neutral-800 bg-neutral-900 transition-[width] duration-150 ${
        collapsed ? "w-14" : "w-64"
      }`}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 px-2 py-3">
          <div className="h-6 w-6 rounded-md bg-red-600" />
          <button
            onClick={onNew}
            title={t("新建连接")}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <Plus size={18} />
          </button>
          <button
            onClick={toggleLocale}
            title="Language / 语言"
            className="rounded-md p-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            {locale === "zh" ? "EN" : "中"}
          </button>
          <button
            onClick={onSettings}
            title={t("应用设置")}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <Settings size={18} />
          </button>
          <button
            onClick={() => setCollapsed(false)}
            title={t("展开侧栏")}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <PanelLeftOpen size={18} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-red-600" />
            <span className="text-sm font-semibold text-neutral-100">Redis Client</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setCollapsed(true)}
              title={t("折叠侧栏")}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            >
              <PanelLeftClose size={16} />
            </button>
            <button
              onClick={onNew}
              title={t("新建连接")}
              className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {configs.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-neutral-500">
            {collapsed ? "＋" : t("还没有连接")}
            {!collapsed && (
              <>
                <br />
                {t("点击右上 + 新建")}
              </>
            )}
          </p>
        ) : (
          groups.map(([group, items]) => (
            <div key={group} className="mb-2">
              {!collapsed && (
                <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                  {group}
                </div>
              )}
              {items.map((c) => (
                <ConnRow
                  key={c.id}
                  config={c}
                  active={c.id === activeId}
                  status={c.id === activeId ? status : "idle"}
                  collapsed={collapsed}
                  onConnect={() => connect(c.id)}
                  onDisconnect={disconnect}
                  onEdit={() => onEdit(c)}
                  onDelete={() => remove(c.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {!collapsed && (
        <div className="flex items-center justify-between border-t border-neutral-800 px-4 py-2 text-[11px] text-neutral-600">
          <span>Redis Client · {t("轻量开源")}</span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={onSettings}
              title={t("应用设置")}
              className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-300"
            >
              <Settings size={13} />
            </button>
            <button
              onClick={toggleLocale}
              title="Language / 语言"
              className="rounded px-1.5 py-0.5 hover:bg-neutral-800 hover:text-neutral-300"
            >
              {locale === "zh" ? "EN" : "中"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function ConnRow({
  config,
  active,
  status,
  collapsed,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
}: {
  config: ConnectionConfig;
  active: boolean;
  status: ConnStatus;
  collapsed: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const { t } = useT();
  const connecting = active && status === "connecting";
  const connected = active && status === "connected";
  const errored = active && status === "error";
  const iconColor = connected
    ? "text-emerald-400"
    : connecting
      ? "text-amber-400"
      : errored
        ? "text-red-400"
        : "text-neutral-500";

  // 折叠态：仅一个状态色图标，点击连接；hover 提示名称（编辑/删除需展开）。
  if (collapsed) {
    return (
      <button
        onClick={() => !active && onConnect()}
        title={`${config.name || t("(未命名)")}\n${config.host}:${config.port}/${config.db}${
          config.tls ? " · TLS" : ""
        }`}
        className={`flex w-full items-center justify-center rounded-md px-2 py-2 ${
          active ? "bg-red-600/15" : "hover:bg-neutral-800/60"
        }`}
      >
        {connecting ? (
          <Loader2 size={16} className={`animate-spin ${iconColor}`} />
        ) : (
          <Server size={16} className={iconColor} />
        )}
      </button>
    );
  }

  return (
    <div
      onClick={() => !active && onConnect()}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${
        active
          ? "bg-red-600/15 text-neutral-100"
          : "text-neutral-300 hover:bg-neutral-800/60"
      }`}
    >
      <Server size={14} className={iconColor} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{config.name || t("(未命名)")}</div>
        <div className="truncate text-[11px] text-neutral-500">
          {config.host}:{config.port}/{config.db}
          {config.tls ? " · TLS" : ""}
        </div>
      </div>

      {connecting && <Loader2 size={14} className="animate-spin text-amber-400" />}

      {confirmDel ? (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] text-white hover:bg-red-500"
          >
            {t("删除")}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDel(false);
            }}
            className="text-[11px] text-neutral-400 hover:text-neutral-200"
          >
            {t("取消")}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          {connected && (
            <button
              title={t("断开")}
              onClick={(e) => {
                e.stopPropagation();
                onDisconnect();
              }}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
            >
              <PlugZap size={13} />
            </button>
          )}
          <button
            title={t("编辑")}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
          >
            <Pencil size={13} />
          </button>
          <button
            title={t("删除")}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDel(true);
            }}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-700 hover:text-red-300"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
