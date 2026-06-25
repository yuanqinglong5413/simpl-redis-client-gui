// JSON 值树视图：String 为 JSON 时提供可折叠树，点击节点复制 JSONPath（$.a.b[0].c）。
// 折叠态仅渲染顶层，大 JSON 也不卡。配合 StringEditor 的「树」模式使用。
import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { useT } from "../../i18n";

/** 每个节点最多渲染的子项数；超出折叠为「+N 更多」，避免超大数组/对象撑爆 DOM。 */
const MAX_CHILDREN = 1000;

/** 判断是否合法 JS 标识符（决定路径用 .x 还是 ["x"]）。 */
function isValidIdent(s: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(s);
}

function joinKey(parent: string, key: string): string {
  return parent === "$"
    ? isValidIdent(key)
      ? `$.${key}`
      : `$["${key}"]`
    : isValidIdent(key)
      ? `${parent}.${key}`
      : `${parent}["${key}"]`;
}

export function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs leading-relaxed">
      <JsonNode name="$" path="$" value={data} depth={0} />
    </div>
  );
}

function JsonNode({
  name,
  path,
  value,
  depth,
}: {
  name: string;
  path: string;
  value: unknown;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const [copied, setCopied] = useState(false);
  const { t } = useT();

  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object" && !isArr;
  const isContainer = isArr || isObj;

  // 子项（数组按索引，对象按键）
  const children: [string, unknown][] = isArr
    ? value.map((v, i) => [String(i), v] as [string, unknown])
    : isObj
      ? Object.entries(value as Record<string, unknown>)
      : [];

  const summary = isArr ? `[${children.length}]` : isObj ? `{${children.length}}` : "";

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* 忽略 */
    }
  };

  return (
    <div>
      <div className="flex items-start gap-1" style={{ paddingLeft: depth * 14 }}>
        {isContainer ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-0.5 shrink-0 text-neutral-500 hover:text-neutral-200"
            aria-label={open ? "折叠" : "展开"}
          >
            <ChevronRight
              size={12}
              className={`transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <button
          onClick={copyPath}
          title={`复制路径 ${path}`}
          className="flex min-w-0 flex-1 items-baseline gap-1 text-left hover:bg-neutral-800/40"
        >
          {name !== "$" && <span className="text-sky-400">{name}</span>}
          {name !== "$" && !isContainer && <span className="text-neutral-600">:</span>}
          {isContainer ? (
            <span className="text-neutral-400">
              {isArr ? "Array" : "Object"}{" "}
              <span className="text-neutral-600">{summary}</span>
            </span>
          ) : (
            <ValueLeaf value={value} />
          )}
          {copied && <Check size={11} className="shrink-0 text-emerald-400" />}
        </button>
      </div>
      {isContainer && open && (
        <div>
          {children.length === 0 ? (
            <div className="text-neutral-600" style={{ paddingLeft: (depth + 1) * 14 + 12 }}>
              {isArr ? t("(空数组)") : t("(空对象)")}
            </div>
          ) : (
            <>
              {children.slice(0, MAX_CHILDREN).map(([k, v]) => (
                <JsonNode
                  key={k}
                  name={isArr ? k : `"${k}"`}
                  path={isArr ? `${path}[${k}]` : joinKey(path, k)}
                  value={v}
                  depth={depth + 1}
                />
              ))}
              {children.length > MAX_CHILDREN && (
                <div className="text-neutral-600" style={{ paddingLeft: (depth + 1) * 14 + 12 }}>
                  {t("… 还有 {n} 项未渲染（超过上限 {max}）", {
                    n: children.length - MAX_CHILDREN,
                    max: MAX_CHILDREN,
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ValueLeaf({ value }: { value: unknown }) {
  if (value === null) return <span className="text-neutral-500">null</span>;
  if (typeof value === "string")
    return <span className="break-all text-emerald-300">"{value}"</span>;
  if (typeof value === "number") return <span className="text-amber-300">{value}</span>;
  if (typeof value === "boolean") return <span className="text-violet-300">{String(value)}</span>;
  return <span className="text-neutral-300">{String(value)}</span>;
}
