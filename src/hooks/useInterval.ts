// 声明式 setInterval：回调总是读最新闭包（经 ref），定时器仅在 delay 变化时重建。
// delayMs 为 null/<=0 时不启动（= 暂停/关闭）。避免把易变回调放进依赖数组导致的 churn / stale closure。
import { useEffect, useRef } from "react";

export function useInterval(callback: () => void, delayMs: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (delayMs == null || delayMs <= 0) return;
    const id = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}
