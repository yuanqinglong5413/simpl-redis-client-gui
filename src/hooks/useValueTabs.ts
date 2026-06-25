// 值标签管理器：每个打开的 key 一个标签，独立持 detail（类型+TTL+值）与自动刷新设置，
// 以及大集合的**分页状态**（pagePos/nextPos/prevStack）。
// 与 useKeys（纯列表）经回调同步：删 key → 移行，改 TTL → 更新行。
// 所有按 key 更新走 setTabs(prev => map)，方法以 key 入参、不捕获单标签状态，避免闭包过期。
import { useCallback, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import type { KeyDetail, PagePos, RedisType, WriteOp } from "../types";

/** 集合分页页大小（与后端 VALUE_PAGE 对齐）。 */
export const VALUE_PAGE = 200;

/** 集合类型的起始分页位置。 */
function startPos(ty: RedisType): PagePos {
  if (ty === "list" || ty === "zset") return { by: "offset", offset: 0 };
  if (ty === "hash" || ty === "set") return { by: "cursor", cursor: 0 };
  return { by: "after_id", id: "-" }; // stream
}

/** 一个打开的值标签。 */
export interface ValueTab {
  key: string;
  detail: KeyDetail | null;
  /** 首次取值（全屏 spinner）。 */
  loading: boolean;
  error: string | null;
  /** 静默刷新中（按钮转圈，不闪 spinner）。 */
  refreshing: boolean;
  writing: boolean;
  auto: boolean;
  /** 自动刷新间隔（秒）。 */
  interval: number;
  /** 当前分页位置（string/unknown=null，无分页）。 */
  pagePos: PagePos | null;
  /** 下一页位置（null=无更多）。 */
  nextPos: PagePos | null;
  /** 回退用的历史位置栈。 */
  prevStack: PagePos[];
}

interface UseValueTabsOpts {
  activeId: string | null;
  /** 新标签的默认自动刷新间隔（秒，取自连接偏好）。 */
  defaultAutoSecs: number;
  /** key 被删/不存在时通知列表移除该行。 */
  onKeyDeleted: (key: string) => void;
  /** TTL 变更时通知列表更新该行。 */
  onTtlChanged: (key: string, ttl: number | null) => void;
}

const NOT_EXIST = /none|not exist|不存在|no such/i;

export function useValueTabs(opts: UseValueTabsOpts) {
  const { activeId, defaultAutoSecs } = opts;

  const [tabs, setTabs] = useState<ValueTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // 用 ref 读最新值，使回调稳定（empty deps）且不踩闭包过期；opts 回调可能由调用方传内联箭头（不稳定），也走 ref。
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const onKeyDeletedRef = useRef(opts.onKeyDeleted);
  onKeyDeletedRef.current = opts.onKeyDeleted;
  const onTtlChangedRef = useRef(opts.onTtlChanged);
  onTtlChangedRef.current = opts.onTtlChanged;

  // 更新单个标签的部分字段（找不到则 no-op）。
  const patch = useCallback((key: string, p: Partial<ValueTab>) => {
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, ...p } : t)));
  }, []);

  const setActive = useCallback((key: string) => setActiveKey(key), []);

  const closeTab = useCallback((key: string) => {
    const prev = tabsRef.current;
    const idx = prev.findIndex((t) => t.key === key);
    if (idx === -1) return;
    setTabs((p) => p.filter((t) => t.key !== key));
    if (activeKeyRef.current === key) {
      const remaining = prev.filter((t) => t.key !== key);
      const neighbor = remaining[idx - 1] ?? remaining[0] ?? null;
      setActiveKey(neighbor ? neighbor.key : null);
    }
  }, []);

  // 首次/整体取值：getKeyDetail（含类型+TTL+总数+首页）。重置分页到首页。
  const fetchKey = useCallback(
    async (key: string, silent: boolean) => {
      if (!activeId) return;
      patch(key, silent ? { refreshing: true, error: null } : { loading: true, error: null });
      try {
        const detail = await ipc.getKeyDetail(activeId, key);
        patch(key, {
          detail,
          loading: false,
          refreshing: false,
          error: null,
          pagePos: detail.total != null ? startPos(detail.type) : null,
          nextPos: detail.next_pos,
          prevStack: [],
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        patch(key, { loading: false, refreshing: false, error: msg });
        if (NOT_EXIST.test(msg)) {
          closeTab(key);
          onKeyDeletedRef.current(key);
        }
      }
    },
    [activeId, patch, closeTab],
  );

  // 取某一页：readValuePage，更新 value + 当前页 + 下一页（不跳页、不动 prevStack）。
  const fetchPage = useCallback(
    async (key: string, pos: PagePos) => {
      if (!activeId) return;
      const tab = tabsRef.current.find((t) => t.key === key);
      const ty = tab?.detail?.type;
      if (!ty) return;
      patch(key, { refreshing: true, error: null });
      try {
        const page = await ipc.readValuePage(activeId, key, ty, pos, VALUE_PAGE);
        setTabs((prev) =>
          prev.map((t) =>
            t.key === key && t.detail
              ? {
                  ...t,
                  detail: { ...t.detail, value: page.value },
                  pagePos: pos,
                  nextPos: page.next,
                  refreshing: false,
                  error: null,
                }
              : t,
          ),
        );
      } catch (e) {
        patch(key, { refreshing: false, error: e instanceof Error ? e.message : String(e) });
      }
    },
    [activeId, patch],
  );

  // 刷新当前页（分页中 → fetchPage(current)；否则 fetchKey）。翻页/写后/自动刷新复用。
  const reload = useCallback(
    async (key: string) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (tab?.pagePos) await fetchPage(key, tab.pagePos);
      else await fetchKey(key, true);
    },
    [fetchPage, fetchKey],
  );

  const openKey = useCallback(
    (key: string) => {
      if (tabsRef.current.some((t) => t.key === key)) {
        setActiveKey(key);
        return;
      }
      setTabs((prev) => [
        ...prev,
        {
          key,
          detail: null,
          loading: true,
          error: null,
          refreshing: false,
          writing: false,
          auto: false,
          interval: defaultAutoSecs,
          pagePos: null,
          nextPos: null,
          prevStack: [],
        },
      ]);
      setActiveKey(key);
      void fetchKey(key, false);
    },
    [defaultAutoSecs, fetchKey],
  );

  const refresh = useCallback((key: string) => {
    void reload(key);
  }, [reload]);

  // 跳到指定位置（前/后翻/跳页共用）：把当前 pagePos 压栈，再取新页。
  const goTo = useCallback(
    (key: string, pos: PagePos) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab) return;
      const newStack = tab.pagePos ? [...tab.prevStack, tab.pagePos] : tab.prevStack;
      setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, prevStack: newStack } : t)));
      void fetchPage(key, pos);
    },
    [fetchPage],
  );

  const nextPage = useCallback(
    (key: string) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (tab?.nextPos) goTo(key, tab.nextPos);
    },
    [goTo],
  );

  const gotoPage = useCallback(
    (key: string, n: number) => {
      goTo(key, { by: "offset", offset: Math.max(0, n) * VALUE_PAGE });
    },
    [goTo],
  );

  const prevPage = useCallback(
    (key: string) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab || !tab.prevStack.length) return;
      const newStack = [...tab.prevStack];
      const prev = newStack.pop()!;
      setTabs((prevTabs) =>
        prevTabs.map((t) => (t.key === key ? { ...t, prevStack: newStack } : t)),
      );
      void fetchPage(key, prev);
    },
    [fetchPage],
  );

  const write = useCallback(
    async (key: string, op: WriteOp) => {
      if (!activeId) return;
      patch(key, { writing: true });
      try {
        await ipc.writeKey(activeId, key, op);
        await reload(key); // 刷新当前页（值 + 类型 + TTL 一起更新）
      } finally {
        patch(key, { writing: false });
      }
    },
    [activeId, patch, reload],
  );

  const setTtl = useCallback(
    async (key: string, ttl: number | null) => {
      if (!activeId) return;
      try {
        await ipc.setTtl(activeId, key, ttl);
        setTabs((prev) =>
          prev.map((t) =>
            t.key === key && t.detail ? { ...t, detail: { ...t.detail, ttl } } : t,
          ),
        );
        onTtlChangedRef.current(key, ttl);
      } catch (e) {
        patch(key, { error: e instanceof Error ? e.message : String(e) });
      }
    },
    [activeId, patch],
  );

  const deleteKey = useCallback(
    async (key: string) => {
      if (!activeId) return;
      try {
        await ipc.deleteKey(activeId, key);
      } catch (e) {
        patch(key, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
      closeTab(key);
      onKeyDeletedRef.current(key);
    },
    [activeId, patch, closeTab],
  );

  const setAuto = useCallback((key: string, on: boolean) => patch(key, { auto: on }), [patch]);
  const setIntervalSecs = useCallback(
    (key: string, n: number) => patch(key, { interval: n }),
    [patch],
  );

  const closeAll = useCallback(() => {
    setTabs([]);
    setActiveKey(null);
  }, []);

  return {
    tabs,
    activeKey,
    openKey,
    setActive,
    closeTab,
    closeAll,
    refresh,
    nextPage,
    prevPage,
    gotoPage,
    write,
    setTtl,
    deleteKey,
    setAuto,
    setIntervalSecs,
  };
}
