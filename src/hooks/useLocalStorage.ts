// 受 localStorage 持久化的状态：UI 偏好（分隔比例 / 视图 / 当前主标签 等）刷新后保留。
// 失败（隐私模式 / 配额）静默降级为内存态，不抛错。
import { useCallback, useState } from "react";

export function useLocalStorage<T>(
  key: string,
  initial: T | (() => T),
): [T, (v: T | ((prev: T) => T)) => void] {
  const [stored, setStored] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw) as T;
    } catch {
      /* 忽略：降级内存态 */
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setStored((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* 忽略 */
        }
        return next;
      });
    },
    [key],
  );

  return [stored, set];
}
