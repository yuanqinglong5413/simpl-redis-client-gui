// 轻量右键菜单：createPortal 到 body（避免被 overflow-hidden 裁切），
// 点击菜单内不关闭（交给项 onClick），点击外部 / Esc 关闭。
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && ref.current.contains(e.target as Node)) return; // 点菜单内：交给项处理
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 延迟一帧绑定，避免本次触发右键的事件立刻把它关掉
    const id = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // 视口边界回退
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - items.length * 34 - 12);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 min-w-[168px] rounded-md border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-2xl"
      style={{ left, top }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          disabled={it.disabled}
          onClick={() => {
            it.onClick();
            onClose();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40 ${
            it.danger
              ? "text-red-300 hover:bg-red-950/40"
              : "text-neutral-200 hover:bg-neutral-800"
          }`}
        >
          {it.icon}
          <span>{it.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
