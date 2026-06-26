// 左侧栏：连接列表（按分组）+ 新建/编辑/删除/连接/断开/拖拽归类。可折叠为图标轨。
// 分组以 useGroups() 的 GroupMeta 为权威顺序 join configs：
//  - 默认组(__default__)固定末尾；其余按 order 升序、created_at 次序
//  - 组内连接按 last_used_at 降序（最近使用置顶）
//  - 引用不存在 group 名的连接 → 末尾「未分组」孤立桶
// 交互：分组 header 可折叠/右键管理/拖拽 drop 目标；连接行可拖拽到分组归类。
import { useMemo, useState, type DragEvent, type MouseEvent } from "react";
import {
  FolderPlus,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  PlugZap,
  Search,
  Server,
  Settings,
  Trash2,
} from "lucide-react";
import type { ConnectionConfig, GroupEnv, GroupMeta } from "../types";
import { DEFAULT_GROUP } from "../types";
import { useConnections, type ConnStatus } from "../hooks/useConnections";
import { useGroups } from "../hooks/useGroups";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useT } from "../i18n";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { GroupEditDialog } from "./GroupEditDialog";

interface Props {
  onNew: () => void;
  onEdit: (config: ConnectionConfig) => void;
  onSettings: () => void;
}

/** 环境标识徽章（PROD/STAGING；DEV 不显示）。全大写英文标签是技术约定，不做 i18n。 */
const ENV_BADGE: Partial<Record<GroupEnv, { cls: string; text: string }>> = {
  prod: { cls: "bg-red-600/20 text-red-300", text: "PROD" },
  staging: { cls: "bg-amber-600/20 text-amber-300", text: "STAGING" },
};

type GroupDialog =
  | { mode: "new"; newOrder: number }
  | { mode: "edit"; meta: GroupMeta }
  | null;

export function Sidebar({ onNew, onEdit, onSettings }: Props) {
  const { configs, activeId, status, connect, disconnect, remove } = useConnections();
  const { groups, moveConnection } = useGroups();
  const { t, locale, setLocale } = useT();
  const [collapsed, setCollapsed] = useLocalStorage<boolean>("rc:sidebarCollapsed", false);
  const [collapsedGroups, setCollapsedGroups] = useLocalStorage<string[]>(
    "rc:collapsedGroups",
    [],
  );
  const [query, setQuery] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; meta: GroupMeta } | null>(null);
  const [dialog, setDialog] = useState<GroupDialog>(null);
  const toggleLocale = () => setLocale(locale === "zh" ? "en" : "zh");

  // 新建分组用的初始 order（追加到末尾：当前最大非默认组 order + 1）
  const newOrder = useMemo(
    () => Math.max(0, ...groups.filter((g) => g.name !== DEFAULT_GROUP).map((g) => g.order)) + 1,
    [groups],
  );

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? configs.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            `${c.host}:${c.port}`.toLowerCase().includes(q),
        )
      : configs;
    const known = new Set(groups.map((g) => g.name));
    known.add(DEFAULT_GROUP);
    // 确保默认组始终存在（groups 尚未加载时也渲染 group=null 的连接）
    const all: GroupMeta[] = groups.some((g) => g.name === DEFAULT_GROUP)
      ? groups
      : [
          ...groups,
          { name: DEFAULT_GROUP, environment: "dev", order: 0, color: null, note: null, created_at: 0 },
        ];
    const sorted = [...all].sort((a, b) => {
      const ad = a.name === DEFAULT_GROUP;
      const bd = b.name === DEFAULT_GROUP;
      if (ad !== bd) return ad ? 1 : -1; // 默认组固定末尾
      return a.order - b.order || a.created_at - b.created_at;
    });
    const result: { key: string; name: string; meta: GroupMeta | null; items: ConnectionConfig[] }[] =
      [];
    for (const g of sorted) {
      const items = filtered
        .filter((c) => (c.group ?? DEFAULT_GROUP) === g.name)
        .sort((a, b) => (b.last_used_at ?? 0) - (a.last_used_at ?? 0));
      if (items.length || !q) {
        result.push({ key: g.name, name: g.name, meta: g, items });
      }
    }
    const orphans = filtered
      .filter((c) => {
        const g = c.group ?? DEFAULT_GROUP;
        return g !== DEFAULT_GROUP && !known.has(g);
      })
      .sort((a, b) => (b.last_used_at ?? 0) - (a.last_used_at ?? 0));
    if (orphans.length) {
      result.push({ key: "__orphan__", name: t("未分组"), meta: null, items: orphans });
    }
    return result;
  }, [configs, groups, query, t]);

  const isGroupCollapsed = (name: string) => !query && collapsedGroups.includes(name);
  const toggleGroup = (name: string) =>
    setCollapsedGroups((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );

  const handleDrop = (e: DragEvent, name: string) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/conn-id");
    if (id) void moveConnection(id, name === DEFAULT_GROUP ? null : name);
  };

  const menuItems: MenuItem[] = menu
    ? [{ label: t("编辑分组"), onClick: () => setDialog({ mode: "edit", meta: menu.meta }) }]
    : [];

  return (
    <aside
      className={`flex h-full flex-col border-r border-neutral-800 bg-neutral-900 transition-[width] duration-150 ${
        collapsed ? "w-14" : "w-64"
      }`}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 px-2 py-3">
          <div className="h-6 w-6 rounded-md bg-red-600" />
          <button onClick={onNew} title={t("新建连接")} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
            <Plus size={18} />
          </button>
          <button onClick={() => setDialog({ mode: "new", newOrder })} title={t("新建分组")} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
            <FolderPlus size={18} />
          </button>
          <button onClick={toggleLocale} title="Language / 语言" className="rounded-md p-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
            {locale === "zh" ? "EN" : "中"}
          </button>
          <button onClick={onSettings} title={t("应用设置")} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
            <Settings size={18} />
          </button>
          <button onClick={() => setCollapsed(false)} title={t("展开侧栏")} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
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
            <button onClick={() => setCollapsed(true)} title={t("折叠侧栏")} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
              <PanelLeftClose size={16} />
            </button>
            <button onClick={() => setDialog({ mode: "new", newOrder })} title={t("新建分组")} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
              <FolderPlus size={18} />
            </button>
            <button onClick={onNew} title={t("新建连接")} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
              <Plus size={18} />
            </button>
          </div>
        </div>
      )}

      {/* 搜索框（仅展开态） */}
      {!collapsed && (
        <div className="px-2 pb-1">
          <div className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1">
            <Search size={13} className="shrink-0 text-neutral-500" />
            <input
              className="min-w-0 flex-1 bg-transparent text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
              placeholder={t("搜索连接...")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button onClick={() => setQuery("")} className="shrink-0 text-neutral-600 hover:text-neutral-300" title={t("取消")}>
                ✕
              </button>
            )}
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
          sections.map((sec, idx) => {
            const secCollapsed = isGroupCollapsed(sec.name);
            const color = sec.meta?.color ?? null;
            const droppable = sec.meta !== null;
            return (
              <div key={sec.key} className={idx > 0 ? "mt-1" : ""}>
                {!collapsed && (
                  <GroupHeader
                    name={sec.name}
                    meta={sec.meta}
                    count={sec.items.length}
                    isCollapsed={secCollapsed}
                    isDragOver={dragOver === sec.name}
                    droppable={droppable}
                    onToggle={() => toggleGroup(sec.name)}
                    onDragOver={(e) => {
                      if (droppable) {
                        e.preventDefault();
                        setDragOver(sec.name);
                      }
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => handleDrop(e, sec.name)}
                    onContextMenu={(e) => {
                      if (sec.meta && sec.name !== DEFAULT_GROUP) {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, meta: sec.meta });
                      }
                    }}
                  />
                )}
                {!secCollapsed &&
                  sec.items.map((c) => (
                    <ConnRow
                      key={c.id}
                      config={c}
                      active={c.id === activeId}
                      status={c.id === activeId ? status : "idle"}
                      sidebarCollapsed={collapsed}
                      groupColor={color}
                      onConnect={() => connect(c.id)}
                      onDisconnect={disconnect}
                      onEdit={() => onEdit(c)}
                      onDelete={() => remove(c.id)}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>

      {!collapsed && (
        <div className="flex items-center justify-between border-t border-neutral-800 px-4 py-2 text-[11px] text-neutral-600">
          <span>Redis Client · {t("轻量开源")}</span>
          <div className="flex items-center gap-0.5">
            <button onClick={onSettings} title={t("应用设置")} className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-300">
              <Settings size={13} />
            </button>
            <button onClick={toggleLocale} title="Language / 语言" className="rounded px-1.5 py-0.5 hover:bg-neutral-800 hover:text-neutral-300">
              {locale === "zh" ? "EN" : "中"}
            </button>
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
      {dialog && (
        <GroupEditDialog
          initial={dialog.mode === "edit" ? dialog.meta : null}
          newOrder={dialog.mode === "new" ? dialog.newOrder : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </aside>
  );
}

/** 分组标题行：折叠箭头 + 色点 + 名称 + 环境徽章 + 连接数；可作拖拽 drop 目标 + 右键管理。 */
function GroupHeader({
  name,
  meta,
  count,
  isCollapsed,
  isDragOver,
  droppable,
  onToggle,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
}: {
  name: string;
  meta: GroupMeta | null;
  count: number;
  isCollapsed: boolean;
  isDragOver: boolean;
  droppable: boolean;
  onToggle: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const { t } = useT();
  const display = name === DEFAULT_GROUP ? t("默认") : name;
  const badge = meta?.environment ? ENV_BADGE[meta.environment] : undefined;
  const dragProps = droppable ? { onDragOver, onDragLeave, onDrop } : {};
  return (
    <div
      className={`flex items-center gap-1 px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500 ${
        isDragOver ? "rounded-md bg-neutral-800/60" : ""
      }`}
      onContextMenu={onContextMenu}
      {...dragProps}
    >
      <button
        onClick={onToggle}
        className="w-3 shrink-0 text-neutral-600 hover:text-neutral-300"
        aria-label={isCollapsed ? "▸" : "▾"}
      >
        {isCollapsed ? "▸" : "▾"}
      </button>
      {meta?.color ? (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} />
      ) : (
        <span className="w-2 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{display}</span>
      {badge && (
        <span className={`shrink-0 rounded px-1 text-[9px] ${badge.cls}`}>{badge.text}</span>
      )}
      <span className="shrink-0 text-neutral-600">{count}</span>
    </div>
  );
}

function ConnRow({
  config,
  active,
  status,
  sidebarCollapsed,
  groupColor,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
}: {
  config: ConnectionConfig;
  active: boolean;
  status: ConnStatus;
  sidebarCollapsed: boolean;
  groupColor: string | null;
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

  // 拖拽归类：dataTransfer 带 conn-id，drop 到分组 header 即移动。
  const dragStart = (e: DragEvent) => {
    e.dataTransfer.setData("text/conn-id", config.id);
    e.dataTransfer.effectAllowed = "move";
  };

  // 折叠态：仅一个状态色图标，左侧色条暗示所属分组；点击连接；可拖拽。
  if (sidebarCollapsed) {
    return (
      <button
        draggable
        onDragStart={dragStart}
        onClick={() => !active && onConnect()}
        title={`${config.name || t("(未命名)")}\n${config.host}:${config.port}/${config.db}${
          config.tls ? " · TLS" : ""
        }`}
        className={`mt-0.5 flex w-full items-center justify-center rounded-md border-l-2 px-2 py-2 ${
          active ? "border-red-500 bg-red-600/15" : "border-transparent hover:bg-neutral-800/60"
        }`}
        style={!active && groupColor ? { borderLeftColor: groupColor } : undefined}
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
      draggable
      onDragStart={dragStart}
      onClick={() => !active && onConnect()}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${
        active ? "bg-red-600/15 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800/60"
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
