// Key 浏览器：DB 切换 + pattern/类型过滤 + 游标分页 + 多标签值查看 + 右键菜单。
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Clock,
  Copy,
  CopyPlus,
  FolderSearch,
  HardDrive,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useConnections } from "../hooks/useConnections";
import { useActiveEnv } from "../lib/env";
import { useKeys } from "../hooks/useKeys";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useValueTabs } from "../hooks/useValueTabs";
import { useT } from "../i18n";
import { effectiveAutoRefresh, effectiveDefaultView, effectiveSeparator } from "../lib/connPrefs";
import { fmtBytes } from "../lib/format";
import { ipc } from "../lib/ipc";
import type { RedisType } from "../types";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { KeyTreeView } from "./KeyTree";
import { Segmented, Toolbar } from "./ui";
import { ValueTabs } from "./ValueTabs";

const TYPE_OPTIONS: { value: RedisType | null; label: string }[] = [
  { value: null, label: "全部" },
  { value: "string", label: "String" },
  { value: "hash", label: "Hash" },
  { value: "list", label: "List" },
  { value: "set", label: "Set" },
  { value: "zset", label: "ZSet" },
  { value: "stream", label: "Stream" },
];

/** 累计 key 软上限：超过则提示收窄 pattern（虚拟滚动留作后续优化）。 */
const SOFT_CAP = 10_000;

type MenuTarget = { kind: "key" | "folder"; path: string };
type Notice = { text: string; busy?: boolean } | null;
type Confirm = { title: string; desc: string; danger?: boolean; requireText?: string; onOk: () => Promise<void> | void } | null;
type PromptState = {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmText?: string;
  onOk: (val: string) => Promise<void> | void;
} | null;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function KeyBrowser() {
  const { configs, activeId, serverInfo, db, setDb, dbError } = useConnections();
  const { t } = useT();
  const k = useKeys();
  const active = configs.find((c) => c.id === activeId) ?? null;
  // 值标签管理器：点 key 开标签、多 key 并行查看；删 key/改 TTL 经回调同步列表。
  const tabs = useValueTabs({
    activeId,
    defaultAutoSecs: effectiveAutoRefresh(active),
    onKeyDeleted: k.removeKeyBrief,
    onTtlChanged: (key, ttl) => k.patchKeyBrief(key, { ttl }),
  });
  const isCluster = serverInfo?.mode === "cluster";
  // 视图/分隔比例持久化：刷新或重连后保留（连接偏好仅作首次缺省）。
  const [view, setView] = useLocalStorage<"flat" | "tree">("rc:view", () =>
    effectiveDefaultView(active),
  );
  const separator = effectiveSeparator(active);

  // 右键菜单 / 结果 toast / 危险确认弹窗 / 输入式弹窗（重命名/复制/批量 TTL）
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const activeEnv = useActiveEnv();
  const [confirmText, setConfirmText] = useState("");
  // 生产环境：危险操作加「⚠ 生产环境」前缀 + 要求输入 "prod" 确认；否则原样。
  const guardedConfirm = useCallback(
    (c: NonNullable<Confirm>) => {
      setConfirmText("");
      if (activeEnv === "prod" && c.danger) {
        setConfirm({ ...c, desc: `${t("⚠ 生产环境")}\n${c.desc}`, requireText: "prod" });
      } else {
        setConfirm(c);
      }
    },
    [activeEnv, t],
  );
  const noticeTimer = useRef<number | null>(null);

  // 列表/值区分隔比例持久化。
  const splitRef = useRef<HTMLDivElement>(null);
  const [splitPct, setSplitPct] = useLocalStorage<number>("rc:splitPct", 50);

  // 平铺视图虚拟滚动：只渲染可见行（固定 32px），上万 key 不卡。树视图折叠态 DOM 本就小，暂不虚拟化。
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: view === "flat" ? k.keys.length : 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => 32,
    overscan: 24,
  });
  const onHandleDown = (e: MouseEvent) => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const move = (ev: globalThis.MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(80, Math.max(20, pct)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // M1.2 平铺视图键盘导航：↑/↓ 移动选中并打开标签，虚拟列表下顺带滚入视野
  const onListKeyDown = (e: KeyboardEvent) => {
    if (view !== "flat" || k.keys.length === 0) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const idx = k.keys.findIndex((kb) => kb.key === tabs.activeKey);
    const next =
      e.key === "ArrowDown"
        ? Math.min(k.keys.length - 1, idx < 0 ? 0 : idx + 1)
        : Math.max(0, idx < 0 ? 0 : idx - 1);
    tabs.openKey(k.keys[next].key);
    virtualizer.scrollToIndex(next, { align: "auto" });
  };

  const showNotice = useCallback((text: string, busy = false) => {
    setNotice({ text, busy });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    if (!busy) noticeTimer.current = window.setTimeout(() => setNotice(null), 3000);
  }, []);

  // 计算「当前目录」的 SCAN 前缀：folder→path+sep+*；key→截最后 sep 后 +*。无分隔符/无父目录→null。
  const dirPrefix = (path: string, isFolder: boolean): string | null => {
    if (separator === "") return null;
    if (isFolder) return `${path}${separator}*`;
    const i = path.lastIndexOf(separator);
    if (i < 0) return null;
    return `${path.slice(0, i + 1)}*`;
  };

  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showNotice(t("已复制"));
      } catch {
        showNotice(t("复制失败"));
      }
    },
    [showNotice, t],
  );

  const memKey = useCallback(
    async (key: string) => {
      if (!activeId) return;
      showNotice(t("计算中…"), true);
      try {
        const bytes = await ipc.keyMemoryUsage(activeId, key);
        showNotice(
          bytes == null ? t("{key}：无法获取大小", { key }) : t("{key}：{bytes}", { key, bytes: fmtBytes(bytes) }),
        );
      } catch (e) {
        showNotice(errMsg(e));
      }
    },
    [activeId, showNotice, t],
  );

  const memDir = useCallback(
    async (prefix: string) => {
      if (!activeId) return;
      showNotice(t("扫描中…"), true);
      try {
        const s = await ipc.patternStats(activeId, prefix);
        showNotice(t("{count} 个 key · {bytes}", { count: s.count, bytes: fmtBytes(s.bytes) }));
      } catch (e) {
        showNotice(errMsg(e));
      }
    },
    [activeId, showNotice, t],
  );

  const deleteKeyMenu = useCallback(
    (key: string) => {
      guardedConfirm({
        title: t("删除 Key"),
        desc: t("确认删除 {key} ？", { key }),
        danger: true,
        onOk: async () => {
          if (!activeId) return;
          try {
            await ipc.deleteKey(activeId, key);
          } catch (e) {
            showNotice(errMsg(e));
            return;
          }
          tabs.closeTab(key);
          k.removeKeyBrief(key);
          showNotice(t("已删除"));
        },
      });
    },
    [activeId, tabs, k, showNotice, t, guardedConfirm],
  );

  const deleteDirMenu = useCallback(
    (prefix: string) => {
      if (!activeId) return;
      showNotice(t("统计中…"), true);
      ipc
        .patternStats(activeId, prefix)
        .then((s) => {
          setNotice(null);
          guardedConfirm({
            title: t("删除目录"),
            desc: t("将删除 {count} 个 key（匹配 {prefix}）。此操作不可撤销！", {
              count: s.count,
              prefix,
            }),
            danger: true,
            onOk: async () => {
              showNotice(t("删除中…"), true);
              try {
                const n = await ipc.deleteByPattern(activeId!, prefix);
                showNotice(t("已删除 {n} 个 key", { n }));
                k.refresh();
              } catch (e) {
                showNotice(errMsg(e));
              }
            },
          });
        })
        .catch((e) => showNotice(errMsg(e)));
    },
    [activeId, k, showNotice, t, guardedConfirm],
  );

  // 重命名 key：弹输入框 → RENAME → 刷新列表、关旧标签。
  const renameMenu = useCallback(
    (key: string) => {
      setPrompt({
        title: t("重命名 Key"),
        label: t("新 key 名（目标已存在会被覆盖）"),
        initial: key,
        confirmText: t("重命名"),
        onOk: async (newKey) => {
          if (!activeId || !newKey || newKey === key) return;
          try {
            await ipc.renameKey(activeId, key, newKey);
            tabs.closeTab(key);
            k.refresh();
            showNotice(t("已重命名"));
          } catch (e) {
            showNotice(errMsg(e));
          }
        },
      });
    },
    [activeId, tabs, k, showNotice, t],
  );

  // 复制为副本：弹输入框 → COPY（覆盖已存在）→ 刷新列表。
  const copyMenu = useCallback(
    (key: string) => {
      setPrompt({
        title: t("复制 Key"),
        label: t("目标 key 名（已存在将覆盖）"),
        initial: `${key}_copy`,
        confirmText: t("复制"),
        onOk: async (dst) => {
          if (!activeId || !dst || dst === key) return;
          try {
            const ok = await ipc.copyKey(activeId, key, dst, true);
            k.refresh();
            showNotice(ok ? t("已复制") : t("复制失败（Redis < 6.2 不支持 COPY）"));
          } catch (e) {
            showNotice(errMsg(e));
          }
        },
      });
    },
    [activeId, k, showNotice, t],
  );

  // 目录批量设 TTL：先统计数量 → 弹输入框（秒数，空=取消过期）→ 批量 EXPIRE/PERSIST。
  const setTtlDirMenu = useCallback(
    (prefix: string) => {
      if (!activeId) return;
      showNotice(t("统计中…"), true);
      ipc
        .patternStats(activeId, prefix)
        .then((s) => {
          setNotice(null);
          setPrompt({
            title: t("设置目录 TTL"),
            label: t("匹配 {count} 个 key（{prefix}）。输入秒数；留空 = 取消过期（设为持久）", {
              count: s.count,
              prefix,
            }),
            initial: "",
            placeholder: t("秒"),
            confirmText: t("设置"),
            onOk: async (val) => {
              const trimmed = val.trim();
              const ttl = trimmed === "" ? null : Number(trimmed);
              if (ttl != null && (!Number.isFinite(ttl) || ttl < 0)) {
                showNotice(t("秒数无效"));
                return;
              }
              try {
                const n = await ipc.setTtlByPattern(activeId!, prefix, ttl);
                k.refresh();
                showNotice(
                  ttl == null ? t("已取消 {n} 个 key 的 TTL", { n }) : t("已设置 {n} 个 key 的 TTL", { n }),
                );
              } catch (e) {
                showNotice(errMsg(e));
              }
            },
          });
        })
        .catch((e) => showNotice(errMsg(e)));
    },
    [activeId, k, showNotice, t],
  );

  const buildItems = (target: MenuTarget): MenuItem[] => {
    const isFolder = target.kind === "folder";
    const prefix = dirPrefix(target.path, isFolder);
    return [
      {
        label: isFolder ? t("复制前缀") : t("复制 Key 名"),
        icon: <Copy size={13} />,
        onClick: () => void copyText(target.path),
      },
      {
        label: isFolder ? t("只查看此目录") : t("只查看所在目录"),
        icon: <FolderSearch size={13} />,
        disabled: !prefix,
        onClick: () => prefix && k.search(prefix, "fuzzy"),
      },
      {
        label: isFolder ? t("查看目录存储大小") : t("查看存储大小"),
        icon: <HardDrive size={13} />,
        onClick: () =>
          isFolder ? (prefix && void memDir(prefix)) : void memKey(target.path),
      },
      ...(isFolder
        ? prefix
          ? [
              {
                label: t("设置目录 TTL"),
                icon: <Clock size={13} />,
                onClick: () => void setTtlDirMenu(prefix),
              } as MenuItem,
            ]
          : []
        : [
            {
              label: t("重命名"),
              icon: <Pencil size={13} />,
              onClick: () => renameMenu(target.path),
            } as MenuItem,
            {
              label: t("复制为副本"),
              icon: <CopyPlus size={13} />,
              onClick: () => copyMenu(target.path),
            } as MenuItem,
          ]),
      {
        label: isFolder ? t("删除此目录") : t("删除"),
        icon: <Trash2 size={13} />,
        danger: true,
        onClick: () =>
          isFolder ? (prefix && deleteDirMenu(prefix)) : deleteKeyMenu(target.path),
      },
    ];
  };

  const openMenu = (e: MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, target });
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* 工具栏：单行不换行，搜索主导（flex-1），其余控件 shrink-0，组间 gap-3 */}
      <Toolbar className="gap-3">
        <label className="flex shrink-0 items-center gap-1 text-xs text-neutral-400">
          DB
          <select
            value={db}
            disabled={isCluster}
            onChange={(e) => setDb(Number(e.target.value))}
            title={isCluster ? t("集群模式仅 db 0") : t("切换数据库")}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 disabled:opacity-40"
          >
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>

        <div className="relative min-w-[200px] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            value={k.pattern}
            onChange={(e) => k.setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") k.refresh();
            }}
            placeholder={t("搜索 key，如 user（自动前缀匹配，回车刷新）")}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 py-1 pl-7 pr-2 text-sm text-neutral-100 outline-none focus:border-red-500"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            value={k.typeFilter ?? ""}
            onChange={(e) => k.setTypeFilter((e.target.value || null) as RedisType | null)}
            title={t("按类型过滤")}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ""}>
                {o.value === null ? t("全部") : o.label}
              </option>
            ))}
          </select>

          <label
            className="flex items-center gap-1 text-xs text-neutral-400"
            title={t("勾选后仅显示 key 名完全相等的")}
          >
            <input
              type="checkbox"
              checked={k.matchMode === "exact"}
              onChange={(e) => k.setMatchMode(e.target.checked ? "exact" : "fuzzy")}
              className="accent-red-600"
            />
            {t("完全匹配")}
          </label>

          <Segmented
            value={view}
            title={t("视图")}
            onChange={(v) => setView(v)}
            options={[
              { value: "flat", label: t("平铺") },
              { value: "tree", label: t("树") },
            ]}
          />

          <button
            onClick={k.refresh}
            disabled={k.loading}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-700 px-2.5 py-1 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          >
            {k.loading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            {t("刷新")}
          </button>
        </div>
      </Toolbar>

      {dbError && (
        <div className="border-b border-red-900/40 bg-red-950/30 px-3 py-1 text-xs text-red-300">
          {t("切换 DB 失败：{msg}", { msg: dbError })}
        </div>
      )}
      {k.keys.length >= SOFT_CAP && (
        <div className="border-b border-amber-900/40 bg-amber-950/30 px-3 py-1 text-xs text-amber-300">
          {t("已加载 {n} 条，建议收窄 pattern 或开启虚拟滚动（后续优化）", { n: k.keys.length })}
        </div>
      )}

      {/* 主体：key 列表 + 值面板（可拖拽分隔） */}
      <div ref={splitRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          className="flex min-w-[200px] flex-col border-r border-neutral-800"
          style={{ width: `${splitPct}%` }}
        >
          <div
            ref={listRef}
            className="flex-1 overflow-auto outline-none"
            tabIndex={0}
            onKeyDown={onListKeyDown}
          >
            {k.keys.length === 0 && !k.loading ? (
              <p className="px-3 py-6 text-center text-xs text-neutral-500">
                {k.done ? t("没有匹配的 key") : t("输入 pattern 并刷新")}
              </p>
            ) : view === "tree" ? (
              <KeyTreeView
                keys={k.keys}
                selectedKey={tabs.activeKey}
                onSelect={tabs.openKey}
                separator={separator}
                onContextMenu={(e, node) =>
                  openMenu(e, { kind: node.isFolder ? "folder" : "key", path: node.path })
                }
              />
            ) : (
              // 平铺：虚拟滚动（绝对定位行，容器为总高度）
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((vi) => {
                  const kb = k.keys[vi.index];
                  return (
                    <div
                      key={kb.key}
                      onClick={() => tabs.openKey(kb.key)}
                      onContextMenu={(e) => openMenu(e, { kind: "key", path: kb.key })}
                      style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                      className={`absolute left-0 top-0 flex w-full cursor-pointer items-center border-b border-neutral-800/60 hover:bg-neutral-800/40 ${
                        tabs.activeKey === kb.key ? "bg-red-600/15" : ""
                      }`}
                    >
                      <span
                        className="min-w-0 flex-1 truncate px-3 text-sm text-neutral-100"
                        title={kb.key}
                      >
                        {kb.key}
                      </span>
                      <span className="w-16 shrink-0 px-2 text-xs text-sky-400">{kb.type}</span>
                      <span className="w-16 shrink-0 px-2 text-xs text-neutral-500">
                        {kb.ttl === null ? t("持久") : `${kb.ttl}s`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-neutral-800 px-3 py-2">
            {!k.done ? (
              <button
                onClick={k.loadMore}
                disabled={k.loading}
                className="w-full rounded-md border border-neutral-700 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                {k.loading ? t("加载中…") : t("加载更多")}
              </button>
            ) : (
              k.keys.length > 0 && (
                <p className="text-center text-xs text-neutral-600">{t("已加载全部")}</p>
              )
            )}
          </div>
        </div>

        {/* 拖拽分隔条 */}
        <div
          onMouseDown={onHandleDown}
          className="w-1 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-red-600/60"
          title={t("拖拽调整宽度")}
        />

        <div className="flex-1 min-w-0 overflow-hidden">
          <ValueTabs {...tabs} />
        </div>
      </div>

      {/* 右键菜单 */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildItems(menu.target)}
          onClose={() => setMenu(null)}
        />
      )}

      {/* 结果 toast */}
      {notice && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-100 shadow-2xl">
          {notice.busy && <Loader2 size={14} className="animate-spin text-neutral-400" />}
          <span className={/失败|fail/i.test(notice.text) ? "text-red-300" : ""}>{notice.text}</span>
        </div>
      )}

      {/* 危险确认弹窗 */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
            <h3
              className={`text-base font-semibold ${
                confirm.danger ? "text-red-300" : "text-neutral-100"
              }`}
            >
              {confirm.title}
            </h3>
            <p className="mt-2 whitespace-pre-wrap break-all text-sm text-neutral-300">
              {confirm.desc}
            </p>
            {confirm.requireText && (
              <input
                className="mt-3 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-red-500"
                placeholder={t("输入 {x} 确认", { x: confirm.requireText })}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                {t("取消")}
              </button>
              <button
                onClick={() => {
                  const onOk = confirm.onOk;
                  setConfirm(null);
                  void onOk();
                }}
                disabled={!!confirm.requireText && confirmText.trim() !== confirm.requireText}
                className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("确认")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 输入式弹窗（重命名 / 复制 / 批量 TTL） */}
      {prompt && <PromptModal prompt={prompt} onClose={() => setPrompt(null)} />}
    </div>
  );
}

function PromptModal({
  prompt,
  onClose,
}: {
  prompt: Exclude<PromptState, null>;
  onClose: () => void;
}) {
  const { t } = useT();
  const [val, setVal] = useState(prompt.initial ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setVal(prompt.initial ?? "");
  }, [prompt]);
  const submit = async () => {
    setBusy(true);
    try {
      await prompt.onOk(val);
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-neutral-100">{prompt.title}</h3>
        {prompt.label && (
          <p className="mt-2 whitespace-pre-wrap break-all text-sm text-neutral-400">
            {prompt.label}
          </p>
        )}
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void submit();
          }}
          placeholder={prompt.placeholder}
          className="mt-3 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-red-500"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            {t("取消")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {busy ? t("处理中…") : (prompt.confirmText ?? t("确定"))}
          </button>
        </div>
      </div>
    </div>
  );
}
