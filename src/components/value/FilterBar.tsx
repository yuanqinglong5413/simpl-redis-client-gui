// 值内搜索：当前加载页客户端过滤的共用过滤栏 + 子串高亮。
// 仅过滤「已加载到前端的当前页」，不动分页/IPC（与现有分页模型一致）。
// highlight 只标第一处匹配（够用且零开销）；大小写不敏感。
import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { btnCls, inputCls } from "./common";

/** 过滤栏：输入 + 命中计数(N/M) + 清空。 */
export function FilterBar({
  value,
  onChange,
  total,
  filtered,
}: {
  value: string;
  onChange: (v: string) => void;
  total: number;
  filtered: number;
}) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-1.5">
      <input
        className={`${inputCls} flex-1`}
        placeholder={t("过滤（当前页）")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <>
          <span className="shrink-0 text-[11px] text-neutral-500">
            {filtered}/{total}
          </span>
          <button onClick={() => onChange("")} className={btnCls}>
            {t("清空")}
          </button>
        </>
      )}
    </div>
  );
}

/** 子串高亮：大小写不敏感地标第一处匹配。q 为空或未命中时原样返回。 */
export function Highlight({ text, q }: { text: string; q: string }): ReactNode {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-amber-400/30 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/** 大小写不敏感子串包含。 */
export function matches(text: string, q: string): boolean {
  return !q || text.toLowerCase().includes(q.toLowerCase());
}
