// 5 类内联编辑器 + Stream 只读查看器。每个编辑器通过 onWrite(op) 写、写后由 useKeys 重新取值。
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ValueView, WriteOp } from "../../types";
import { highlightJsonHtml, toBase64, toHex } from "../../lib/text";
import { JsonTree } from "./JsonTree";
import { useT } from "../../i18n";
import { useConnections } from "../../hooks/useConnections";
import { btnCls, dangerBtnCls, inputCls, prettyJson, useAsyncAction } from "./common";
import { FilterBar, Highlight, matches } from "./FilterBar";
import { StreamGroups } from "./StreamGroups";

// CodeMirror 编辑器较重（~130KB），懒加载，仅 String 进入编辑态时加载。
const CodeEditor = lazy(() =>
  import("./CodeEditor").then((m) => ({ default: m.CodeEditor })),
);

type StringValue = Extract<ValueView, { kind: "string" }>;
type HashValue = Extract<ValueView, { kind: "hash" }>;
type ListValue = Extract<ValueView, { kind: "list" }>;
type SetValue = Extract<ValueView, { kind: "set" }>;
type ZSetValue = Extract<ValueView, { kind: "z_set" }>;
type StreamValue = Extract<ValueView, { kind: "stream" }>;

interface WriteProps {
  onWrite: (op: WriteOp) => Promise<void>;
}

// ========== String 视图模式 ==========
type StrMode = "pretty" | "raw" | "base64" | "hex" | "tree";
const STR_MODE_LABEL: Record<StrMode, string> = {
  pretty: "格式化",
  raw: "原始",
  base64: "Base64",
  hex: "Hex",
  tree: "树",
};
/** 超长值截断阈值，避免渲染卡顿。 */
const STR_TRUNC = 200_000;

// ========== String ==========
export function StringEditor({ value, onWrite }: WriteProps & { value: StringValue }) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value.value);
  // 编辑中不回填：自动/手动刷新更新 value 时，不覆盖用户正在输入的草稿（ref 避免 editing 入依赖）。
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    if (!editingRef.current) setDraft(value.value);
  }, [value.value]);
  const act = useAsyncAction();
  const [mode, setMode] = useState<StrMode>("pretty");
  // 编辑态语言（JSON 带高亮/校验；文本为纯文本）。进入编辑时按内容自动判定。
  const [editLang, setEditLang] = useState<"json" | "text">("text");

  const enterEdit = () => {
    setEditLang(value.is_json ? "json" : "text");
    // JSON 进入编辑时预格式化（便于编辑）；否则用原值。
    setDraft(value.is_json ? prettyJson(value.value) : value.value);
    setEditing(true);
  };

  if (!editing) {
    const full = value.value;
    if (!full) {
      return (
        <div className="space-y-2">
          <pre className="whitespace-pre-wrap break-all rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-500">
            {t("(空)")}
          </pre>
          <button onClick={enterEdit} className={btnCls}>
            {t("编辑")}
          </button>
        </div>
      );
    }
    const truncated = full.length > STR_TRUNC;
    const shown = truncated ? full.slice(0, STR_TRUNC) : full;
    const isJsonPretty = mode === "pretty" && value.is_json;
    // 树视图：仅未截断的 JSON 可用（截断后无法完整解析）。
    const showTree = mode === "tree" && value.is_json && !truncated;
    let treeData: unknown = null;
    if (showTree) {
      try {
        treeData = JSON.parse(full);
      } catch {
        /* 解析失败回退到格式化文本 */
      }
    }
    const text =
      mode === "raw"
        ? shown
        : mode === "base64"
          ? toBase64(shown)
          : mode === "hex"
            ? toHex(shown)
            : isJsonPretty
              ? prettyJson(shown)
              : shown;
    const modes: StrMode[] = value.is_json
      ? ["pretty", "tree", "raw", "base64", "hex"]
      : ["pretty", "raw", "base64", "hex"];

    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <div className="flex overflow-hidden rounded-md border border-neutral-700">
            {modes.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-1 text-xs ${
                  mode === m
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-800"
                }`}
              >
                {STR_MODE_LABEL[m] === "Base64" || STR_MODE_LABEL[m] === "Hex"
                  ? STR_MODE_LABEL[m]
                  : t(STR_MODE_LABEL[m])}
              </button>
            ))}
          </div>
          {value.is_json && (
            <span className="rounded bg-emerald-600/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
              {t("JSON")}
            </span>
          )}
          {truncated && (
            <span className="ml-auto text-[11px] text-amber-400">
              {t("已截断（共 {n} 字符）", { n: full.length.toLocaleString() })}
            </span>
          )}
        </div>
        {showTree && treeData !== null ? (
          <JsonTree data={treeData} />
        ) : mode === "tree" && value.is_json ? (
          <pre className="whitespace-pre-wrap break-all rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-amber-300">
            {t("值过大已截断，树视图不可用，请改用「格式化」查看。")}
          </pre>
        ) : isJsonPretty ? (
          <pre
            className="whitespace-pre-wrap break-all rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-100"
            dangerouslySetInnerHTML={{ __html: highlightJsonHtml(text) }}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-all rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-100">
            {text}
          </pre>
        )}
        <button onClick={enterEdit} className={btnCls}>
          {t("编辑")}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <div className="flex overflow-hidden rounded-md border border-neutral-700">
          {(["json", "text"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setEditLang(m)}
              className={`px-2 py-1 text-xs ${
                editLang === m
                  ? "bg-neutral-700 text-neutral-100"
                  : "text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              {m === "json" ? t("JSON") : t("文本")}
            </button>
          ))}
        </div>
        {editLang === "json" && (
          <>
            <button
              className={btnCls}
              onClick={() => {
                try {
                  setDraft(JSON.stringify(JSON.parse(draft), null, 2));
                } catch {
                  /* 非法 JSON，忽略 */
                }
              }}
            >
              {t("格式化")}
            </button>
            <button
              className={btnCls}
              onClick={() => {
                try {
                  setDraft(JSON.stringify(JSON.parse(draft)));
                } catch {
                  /* 非法 JSON，忽略 */
                }
              }}
            >
              {t("压缩")}
            </button>
          </>
        )}
      </div>
      <Suspense
        fallback={
          <div className="flex h-72 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 text-xs text-neutral-500">
            {t("加载编辑器…")}
          </div>
        }
      >
        <CodeEditor value={draft} onChange={setDraft} language={editLang} />
      </Suspense>
      <div className="flex items-center gap-2">
        <button
          disabled={act.busy}
          className={btnCls}
          onClick={() =>
            act.run(async () => {
              // JSON 模式：非法则拦截保存。
              if (editLang === "json") {
                try {
                  JSON.parse(draft);
                } catch (e) {
                  throw new Error(
                    t("JSON 格式错误：{msg}", {
                      msg: e instanceof Error ? e.message : String(e),
                    }),
                  );
                }
              }
              await onWrite({ op: "set_string", value: draft });
              setEditing(false);
            })
          }
        >
          {t("保存")}
        </button>
        <button
          className={btnCls}
          onClick={() => {
            setEditing(false);
            setDraft(value.value);
          }}
        >
          {t("取消")}
        </button>
        {act.error && <span className="text-xs text-red-400">{act.error}</span>}
      </div>
    </div>
  );
}

// ========== Hash ==========
export function HashEditor({ value, onWrite }: WriteProps & { value: HashValue }) {
  const { t } = useT();
  const [nf, setNf] = useState("");
  const [nv, setNv] = useState("");
  const [q, setQ] = useState("");
  const add = useAsyncAction();
  const rows = useMemo(
    () =>
      q ? value.fields.filter((f) => matches(f.field, q) || matches(f.value, q)) : value.fields,
    [q, value.fields],
  );
  return (
    <div className="space-y-1">
      <FilterBar value={q} onChange={setQ} total={value.fields.length} filtered={rows.length} />
      <table className="w-full text-sm">
        <tbody>
          {rows.map((f) => (
            <HashRow key={f.field} field={f.field} val={f.value} q={q} onWrite={onWrite} />
          ))}
        </tbody>
      </table>
      <div className="flex gap-1">
        <input
          className={inputCls}
          placeholder={t("新字段")}
          value={nf}
          onChange={(e) => setNf(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder={t("值")}
          value={nv}
          onChange={(e) => setNv(e.target.value)}
        />
        <button
          disabled={add.busy || !nf}
          className={btnCls}
          onClick={() =>
            add.run(async () => {
              await onWrite({ op: "hash_set", field: nf, value: nv });
              setNf("");
              setNv("");
            })
          }
        >
          {t("新增")}
        </button>
      </div>
      {add.error && <p className="text-xs text-red-400">{add.error}</p>}
    </div>
  );
}

function HashRow({
  field,
  val,
  q,
  onWrite,
}: {
  field: string;
  val: string;
  q: string;
  onWrite: (op: WriteOp) => Promise<void>;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(val);
  // 编辑中不回填：自动/手动刷新更新 val 时，不覆盖正在编辑的草稿（HashRow/ListRow 共用此守卫）。
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    if (!editingRef.current) setDraft(val);
  }, [val]);
  const save = useAsyncAction();
  const del = useAsyncAction();
  if (editing) {
    return (
      <tr className="border-b border-neutral-800/60">
        <td className="w-1/3 break-all px-2 py-1 text-sky-400">{field}</td>
        <td className="px-2 py-1">
          <input className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </td>
        <td className="whitespace-nowrap px-2 py-1">
          <button
            disabled={save.busy}
            className={btnCls}
            onClick={() =>
              save.run(async () => {
                await onWrite({ op: "hash_set", field, value: draft });
                setEditing(false);
              })
            }
          >
            {t("保存")}
          </button>
          <button className={btnCls} onClick={() => { setEditing(false); setDraft(val); }}>
            {t("取消")}
          </button>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-neutral-800/60">
      <td className="w-1/3 break-all px-2 py-1 text-sky-400"><Highlight text={field} q={q} /></td>
      <td className="break-all px-2 py-1 text-neutral-200"><Highlight text={val} q={q} /></td>
      <td className="whitespace-nowrap px-2 py-1">
        <button className={btnCls} onClick={() => setEditing(true)}>
          {t("改")}
        </button>{" "}
        <button
          disabled={del.busy}
          className={dangerBtnCls}
          onClick={() => del.run(() => onWrite({ op: "hash_del", field }))}
        >
          {t("删")}
        </button>
      </td>
    </tr>
  );
}

// ========== List ==========
export function ListEditor({
  value,
  onWrite,
  offset,
}: WriteProps & { value: ListValue; offset: number }) {
  const { t } = useT();
  const [nv, setNv] = useState("");
  const [side, setSide] = useState<"left" | "right">("right");
  const [q, setQ] = useState("");
  const add = useAsyncAction();
  const rows = useMemo(
    () =>
      q
        ? value.items
            .map((it, i) => ({ it, i }))
            .filter(({ it }) => matches(it, q))
        : value.items.map((it, i) => ({ it, i })),
    [q, value.items],
  );
  return (
    <div className="space-y-1">
      <FilterBar value={q} onChange={setQ} total={value.items.length} filtered={rows.length} />
      <div className="space-y-1">
        {rows.map(({ it, i }) => (
          <ListRow key={`${offset + i}`} index={offset + i} val={it} q={q} onWrite={onWrite} />
        ))}
      </div>
      <div className="flex gap-1">
        <select
          className={inputCls}
          value={side}
          onChange={(e) => setSide(e.target.value as "left" | "right")}
        >
          <option value="left">{t("左(LPUSH)")}</option>
          <option value="right">{t("右(RPUSH)")}</option>
        </select>
        <input
          className={inputCls}
          placeholder={t("追加元素")}
          value={nv}
          onChange={(e) => setNv(e.target.value)}
        />
        <button
          disabled={add.busy || !nv}
          className={btnCls}
          onClick={() =>
            add.run(async () => {
              await onWrite({ op: "list_push", side, value: nv });
              setNv("");
            })
          }
        >
          {t("追加")}
        </button>
      </div>
      {add.error && <p className="text-xs text-red-400">{add.error}</p>}
    </div>
  );
}

function ListRow({
  index,
  val,
  q,
  onWrite,
}: {
  index: number;
  val: string;
  q: string;
  onWrite: (op: WriteOp) => Promise<void>;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(val);
  // 编辑中不回填：自动/手动刷新更新 val 时，不覆盖正在编辑的草稿（HashRow/ListRow 共用此守卫）。
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    if (!editingRef.current) setDraft(val);
  }, [val]);
  const save = useAsyncAction();
  const del = useAsyncAction();
  if (editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="w-10 shrink-0 text-right text-neutral-600">{index}</span>
        <input className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button
          disabled={save.busy}
          className={btnCls}
          onClick={() =>
            save.run(async () => {
              await onWrite({ op: "list_set", index, value: draft });
              setEditing(false);
            })
          }
        >
          {t("保存")}
        </button>
        <button className={btnCls} onClick={() => { setEditing(false); setDraft(val); }}>
          {t("取消")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-10 shrink-0 text-right text-neutral-600">{index}</span>
      <span className="flex-1 break-all text-neutral-200"><Highlight text={val} q={q} /></span>
      <button className={btnCls} onClick={() => setEditing(true)}>
        {t("改")}
      </button>
      <button
        disabled={del.busy}
        className={dangerBtnCls}
        onClick={() => del.run(() => onWrite({ op: "list_remove", count: 1, value: val }))}
      >
        {t("删")}
      </button>
    </div>
  );
}

// ========== Set ==========
export function SetEditor({ value, onWrite }: WriteProps & { value: SetValue }) {
  const { t } = useT();
  const [nm, setNm] = useState("");
  const [q, setQ] = useState("");
  const add = useAsyncAction();
  const rows = useMemo(
    () => (q ? value.members.filter((m) => matches(m, q)) : value.members),
    [q, value.members],
  );
  return (
    <div className="space-y-1">
      <FilterBar value={q} onChange={setQ} total={value.members.length} filtered={rows.length} />
      <div className="flex flex-wrap gap-1.5">
        {rows.map((m) => (
          <SetMember key={m} member={m} q={q} onWrite={onWrite} />
        ))}
      </div>
      <div className="flex gap-1">
        <input
          className={inputCls}
          placeholder={t("新成员")}
          value={nm}
          onChange={(e) => setNm(e.target.value)}
        />
        <button
          disabled={add.busy || !nm}
          className={btnCls}
          onClick={() =>
            add.run(async () => {
              await onWrite({ op: "set_add", member: nm });
              setNm("");
            })
          }
        >
          {t("添加")}
        </button>
      </div>
      {add.error && <p className="text-xs text-red-400">{add.error}</p>}
    </div>
  );
}

function SetMember({
  member,
  q,
  onWrite,
}: {
  member: string;
  q: string;
  onWrite: (op: WriteOp) => Promise<void>;
}) {
  const del = useAsyncAction();
  return (
    <span className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200">
      <span className="break-all"><Highlight text={member} q={q} /></span>
      <button
        disabled={del.busy}
        className="text-red-300 hover:text-red-200"
        onClick={() => del.run(() => onWrite({ op: "set_remove", member }))}
      >
        ×
      </button>
    </span>
  );
}

// ========== ZSet ==========
export function ZSetEditor({ value, onWrite }: WriteProps & { value: ZSetValue }) {
  const { t } = useT();
  const [nm, setNm] = useState("");
  const [ns, setNs] = useState("0");
  const [q, setQ] = useState("");
  const add = useAsyncAction();
  const rows = useMemo(
    () =>
      q
        ? value.members.filter((m) => matches(m.member, q) || matches(String(m.score), q))
        : value.members,
    [q, value.members],
  );
  return (
    <div className="space-y-1">
      <FilterBar value={q} onChange={setQ} total={value.members.length} filtered={rows.length} />
      <table className="w-full text-sm">
        <tbody>
          {rows.map((m) => (
            <ZSetRow key={m.member} member={m.member} score={m.score} q={q} onWrite={onWrite} />
          ))}
        </tbody>
      </table>
      <div className="flex gap-1">
        <input
          className={inputCls}
          placeholder={t("成员")}
          value={nm}
          onChange={(e) => setNm(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder={t("分值")}
          value={ns}
          onChange={(e) => setNs(e.target.value)}
        />
        <button
          disabled={add.busy || !nm}
          className={btnCls}
          onClick={() =>
            add.run(async () => {
              await onWrite({ op: "zset_add", member: nm, score: Number(ns) || 0 });
              setNm("");
              setNs("0");
            })
          }
        >
          {t("新增")}
        </button>
      </div>
      {add.error && <p className="text-xs text-red-400">{add.error}</p>}
    </div>
  );
}

function ZSetRow({
  member,
  score,
  q,
  onWrite,
}: {
  member: string;
  score: number;
  q: string;
  onWrite: (op: WriteOp) => Promise<void>;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(score));
  // 编辑中不回填：自动/手动刷新更新 score 时，不覆盖正在编辑的分值草稿。
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    if (!editingRef.current) setDraft(String(score));
  }, [score]);
  const save = useAsyncAction();
  const del = useAsyncAction();
  if (editing) {
    return (
      <tr className="border-b border-neutral-800/60">
        <td className="break-all px-2 py-1 text-neutral-200">{member}</td>
        <td className="w-24 px-2 py-1">
          <input className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </td>
        <td className="whitespace-nowrap px-2 py-1">
          <button
            disabled={save.busy}
            className={btnCls}
            onClick={() =>
              save.run(async () => {
                await onWrite({ op: "zset_add", member, score: Number(draft) || 0 });
                setEditing(false);
              })
            }
          >
            {t("保存")}
          </button>
          <button className={btnCls} onClick={() => { setEditing(false); setDraft(String(score)); }}>
            {t("取消")}
          </button>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-neutral-800/60">
      <td className="break-all px-2 py-1 text-neutral-200"><Highlight text={member} q={q} /></td>
      <td className="w-24 px-2 py-1 text-amber-400">{score}</td>
      <td className="whitespace-nowrap px-2 py-1">
        <button className={btnCls} onClick={() => setEditing(true)}>
          {t("改")}
        </button>{" "}
        <button
          disabled={del.busy}
          className={dangerBtnCls}
          onClick={() => del.run(() => onWrite({ op: "zset_remove", member }))}
        >
          {t("删")}
        </button>
      </td>
    </tr>
  );
}

// ========== Stream（消息条目 + 消费组） ==========
export function StreamViewer({ value, redisKey }: { value: StreamValue; redisKey: string }) {
  const { t } = useT();
  const { activeId } = useConnections();
  const [tab, setTab] = useState<"messages" | "groups">("messages");
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      q
        ? value.entries.filter(
            (e) =>
              matches(e.id, q) ||
              e.fields.some((f) => matches(f.field, q) || matches(f.value, q)),
          )
        : value.entries,
    [q, value.entries],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <div className="flex overflow-hidden rounded-md border border-neutral-700">
          {(
            [
              ["messages", t("消息")],
              ["groups", t("消费组")],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-2 py-1 text-xs ${
                tab === k
                  ? "bg-neutral-700 text-neutral-100"
                  : "text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "messages" ? (
        value.entries.length === 0 ? (
          <p className="text-xs text-neutral-500">{t("无 entry")}</p>
        ) : (
          <>
            <FilterBar
              value={q}
              onChange={setQ}
              total={value.entries.length}
              filtered={rows.length}
            />
            <div className="space-y-2">
              {rows.map((e) => (
                <div key={e.id} className="rounded border border-neutral-800 bg-neutral-950 p-2">
                  <div className="mb-1 text-xs text-sky-400">
                    <Highlight text={e.id} q={q} />
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {e.fields.map((f) => (
                        <tr key={f.field} className="border-b border-neutral-800/40">
                          <td className="w-1/3 break-all px-2 text-neutral-500">
                            <Highlight text={f.field} q={q} />
                          </td>
                          <td className="break-all px-2 text-neutral-200">
                            <Highlight text={f.value} q={q} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </>
        )
      ) : (
        <StreamGroups activeId={activeId} redisKey={redisKey} />
      )}
    </div>
  );
}
