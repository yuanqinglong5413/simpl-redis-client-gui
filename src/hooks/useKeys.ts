// Key 列表状态：游标分页 + 类型过滤 + 切库。
// 值的查看/编辑已拆到 useValueTabs（多标签）。本 hook 仅负责 key 列表，
// 并对外暴露 patchKeyBrief / removeKeyBrief 供标签层同步（改 TTL / 删 key）。
import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import { effectiveScanCount } from "../lib/connPrefs";
import { useConnections } from "./useConnections";
import type { ConnectionConfig, KeyBrief, RedisType } from "../types";

/** 是否含 glob 元字符。 */
function hasGlob(q: string): boolean {
  return q.includes("*") || q.includes("?") || q.includes("[") || q.includes("]");
}

/**
 * 把用户输入转成 SCAN pattern：
 * - 空 → null（SCAN `*`，全量）
 * - exact → 字面量（再由 applyMatch 客户端精确过滤）
 * - fuzzy → 已含 glob 元字符则原样；否则**自动后缀 `*`** 做前缀匹配（用户不必手敲 *）
 */
function scanPattern(pat: string, mode: "fuzzy" | "exact"): string | null {
  const q = pat.trim();
  if (!q) return null;
  if (mode === "exact") return q;
  return hasGlob(q) ? q : `${q}*`;
}

export function useKeys() {
  const { configs, activeId, db } = useConnections();
  // 每页扫描数取自当前连接的浏览偏好（缺省 200）。
  const active: ConnectionConfig | null = configs.find((c) => c.id === activeId) ?? null;
  const pageSize = effectiveScanCount(active);

  const [keys, setKeys] = useState<KeyBrief[]>([]);
  const [cursor, setCursor] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pattern, setPattern] = useState("");
  const [typeFilter, setTypeFilterState] = useState<RedisType | null>(null);
  // 搜索匹配模式：fuzzy=SCAN glob（如 user:*），exact=客户端精确等值过滤。
  const [matchMode, setMatchModeState] = useState<"fuzzy" | "exact">("fuzzy");

  // 记忆上次 activeId；在 effect 内读最新 pattern/typeFilter/matchMode（避免闭包过期）
  const prevActiveRef = useRef<string | null>(null);
  const patternRef = useRef(pattern);
  patternRef.current = pattern;
  const typeFilterRef = useRef(typeFilter);
  typeFilterRef.current = typeFilter;
  const matchModeRef = useRef(matchMode);
  matchModeRef.current = matchMode;

  // exact 模式：客户端过滤 key 名完全相等（对含 glob 元字符的 key 也正确）。
  const applyMatch = useCallback(
    (list: KeyBrief[], pat: string): KeyBrief[] => {
      if (matchModeRef.current === "exact" && pat.trim()) {
        const q = pat.trim();
        return list.filter((kb) => kb.key === q);
      }
      return list;
    },
    [],
  );

  // 重置游标，用指定过滤条件从第 0 页拉取（过滤条件变更/切库/手动刷新共用）
  const resetAndFetch = useCallback(
    async (pat: string, ty: RedisType | null) => {
      if (!activeId) return;
      setLoading(true);
      try {
        const page = await ipc.scanKeys(
          activeId,
          0,
          scanPattern(pat, matchModeRef.current),
          pageSize,
          ty,
        );
        setKeys(applyMatch(page.keys, pat));
        setCursor(page.next_cursor);
        setDone(page.next_cursor === 0);
      } catch (e) {
        console.error("[useKeys] scanKeys 失败", e);
        setKeys([]);
        setDone(true);
      } finally {
        setLoading(false);
      }
    },
    [activeId, pageSize, applyMatch],
  );

  // activeId 变化（换连接：重置全部 + 首拉）或 db 变化（切库：保留 pattern/类型，重扫）
  useEffect(() => {
    const connChanged = prevActiveRef.current !== activeId;
    prevActiveRef.current = activeId;
    if (connChanged) {
      setPattern("");
      setTypeFilterState(null);
    }
    setKeys([]);
    setCursor(0);
    setDone(false);
    if (!activeId) return;

    const pat = connChanged ? "" : patternRef.current;
    const ty = connChanged ? null : typeFilterRef.current;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const page = await ipc.scanKeys(
          activeId,
          0,
          scanPattern(pat, matchModeRef.current),
          pageSize,
          ty,
        );
        if (cancelled) return;
        setKeys(applyMatch(page.keys, pat));
        setCursor(page.next_cursor);
        setDone(page.next_cursor === 0);
      } catch (e) {
        console.error("[useKeys] scan 失败", e);
        if (!cancelled) {
          setKeys([]);
          setDone(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, db, pageSize]);

  const refresh = useCallback(() => {
    void resetAndFetch(pattern, typeFilter);
  }, [resetAndFetch, pattern, typeFilter]);

  const loadMore = useCallback(async () => {
    if (!activeId || loading || done) return;
    setLoading(true);
    try {
      const page = await ipc.scanKeys(
        activeId,
        cursor,
        scanPattern(pattern, matchModeRef.current),
        pageSize,
        typeFilter,
      );
      setKeys((prev) => [...prev, ...applyMatch(page.keys, pattern)]);
      setCursor(page.next_cursor);
      setDone(page.next_cursor === 0);
    } catch (e) {
      console.error("[useKeys] loadMore 失败", e);
      setDone(true);
    } finally {
      setLoading(false);
    }
  }, [activeId, cursor, loading, done, pattern, typeFilter, pageSize, applyMatch]);

  // 类型过滤：下拉变更即应用（自动重新扫描）
  const setTypeFilter = useCallback(
    (t: RedisType | null) => {
      setTypeFilterState(t);
      void resetAndFetch(pattern, t);
    },
    [resetAndFetch, pattern],
  );

  // 供值标签层同步列表（改 TTL / 删 key 后调用）。
  const patchKeyBrief = useCallback((key: string, patch: Partial<KeyBrief>) => {
    setKeys((prev) => prev.map((kb) => (kb.key === key ? { ...kb, ...patch } : kb)));
  }, []);

  const removeKeyBrief = useCallback((key: string) => {
    setKeys((prev) => prev.filter((kb) => kb.key !== key));
  }, []);

  // 切匹配模式：pattern 非空时立即用新模式重扫重过滤。
  const setMatchMode = useCallback(
    (m: "fuzzy" | "exact") => {
      setMatchModeState(m);
      matchModeRef.current = m;
      if (patternRef.current.trim()) {
        void resetAndFetch(patternRef.current, typeFilterRef.current);
      }
    },
    [resetAndFetch],
  );

  // 一次性设置 pattern(+模式) 并立即扫描（供「只看目录」等菜单动作，避免 setState 异步导致的旧 pattern）。
  const search = useCallback(
    (pat: string, mode?: "fuzzy" | "exact") => {
      setPattern(pat);
      patternRef.current = pat;
      if (mode) {
        setMatchModeState(mode);
        matchModeRef.current = mode;
      }
      void resetAndFetch(pat, typeFilterRef.current);
    },
    [resetAndFetch],
  );

  return {
    keys,
    cursor,
    done,
    loading,
    pattern,
    typeFilter,
    matchMode,
    setPattern,
    setTypeFilter,
    setMatchMode,
    search,
    refresh,
    loadMore,
    patchKeyBrief,
    removeKeyBrief,
  };
}
