// 全局布局/表现原语：统一各面板的工具栏、刷新控件、信息卡、互斥按钮组。
// 值编辑器专用样式仍留在 value/common.tsx；这里只放跨面板复用的结构。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";

/** 类型 → 小圆点颜色（仅视觉区分）。string 入参，避免本模块耦合领域类型。 */
const TYPE_DOT: Record<string, string> = {
  string: "bg-emerald-400",
  hash: "bg-sky-400",
  list: "bg-violet-400",
  set: "bg-amber-400",
  zset: "bg-pink-400",
  stream: "bg-rose-400",
  none: "bg-neutral-600",
  unknown: "bg-neutral-600",
};
export function typeDotClass(type: string): string {
  return TYPE_DOT[type] ?? "bg-neutral-600";
}

/** 标准工具栏容器：所有面板工具栏套用，保证高度/内边距/底分隔一致。 */
export function Toolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2 ${className}`}
    >
      {children}
    </div>
  );
}

/** 轻量 ghost 按钮（设TTL/删除等次级动作）。 */
export const quietBtn =
  "rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50";
export const dangerQuietBtn =
  "rounded-md border border-red-900/60 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50";

/** 互斥按钮组（平铺/树、JSON/文本）。 */
export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  title,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <div
      className="flex overflow-hidden rounded-md border border-neutral-700"
      title={title}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2 py-1 text-xs ${
            value === o.value
              ? "bg-neutral-700 text-neutral-100"
              : "text-neutral-400 hover:bg-neutral-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 自动刷新 + 间隔 + 手动刷新（受控）。ValuePanel / ServerMonitor 共用，保证外观一致。 */
export function RefreshControls({
  auto,
  interval,
  onAutoChange,
  onIntervalChange,
  onRefresh,
  refreshing,
  disabled,
}: {
  auto: boolean;
  interval: number;
  onAutoChange: (on: boolean) => void;
  onIntervalChange: (secs: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** 写入中等场景暂停自动刷新的开关仅作用于宿主逻辑；此处仅控制手动按钮可用性。 */
  disabled?: boolean;
}) {
  const inputCls =
    "w-14 rounded-md border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-xs text-neutral-100 disabled:opacity-50";
  const btn =
    "inline-flex items-center gap-1 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => onAutoChange(e.target.checked)}
          className="accent-red-600"
        />
        自动刷新
      </label>
      <input
        type="number"
        min={1}
        value={interval}
        onChange={(e) => onIntervalChange(Number(e.target.value))}
        disabled={!auto}
        className={inputCls}
        title="自动刷新间隔（秒）"
      />
      <span className="text-neutral-600">秒</span>
      <button onClick={onRefresh} disabled={refreshing || disabled} title="刷新" className={btn}>
        {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        刷新
      </button>
    </div>
  );
}

/** 统一信息卡（合并旧 Card/Stat/Metric）。 */
export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-neutral-100" title={value}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 truncate text-[11px] text-neutral-600" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** 按钮触发的下拉菜单（⋯ 收纳用）：点击外部/Esc 关闭，右对齐下拉。 */
export interface MenuOption {
  label: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function MenuButton({
  label,
  options,
  title,
}: {
  label: ReactNode;
  options: MenuOption[];
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={title}
        className="inline-flex items-center rounded-md border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800"
      >
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-[140px] overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-2xl">
          {options.map((o, i) => (
            <button
              key={i}
              disabled={o.disabled}
              onClick={() => {
                setOpen(false);
                o.onClick();
              }}
              className={`flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-neutral-800 disabled:opacity-40 ${
                o.danger ? "text-red-300" : "text-neutral-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
