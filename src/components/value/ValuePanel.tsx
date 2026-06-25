// 值面板：头部（标题行：类型点+key+刷新控件+设TTL/删除；元信息行：类型·TTL·总数）
// + 按 kind 派发编辑器 + 分页栏。头部压成两行，去除旧的「刷新控制独立行」拥挤感。
import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { PagePos, RedisType, ValueView, WriteOp } from "../../types";
import { useInterval } from "../../hooks/useInterval";
import { VALUE_PAGE } from "../../hooks/useValueTabs";
import { useT } from "../../i18n";
import { MenuButton, RefreshControls, dangerQuietBtn, quietBtn, typeDotClass } from "../ui";
import {
  HashEditor,
  ListEditor,
  SetEditor,
  StreamViewer,
  StringEditor,
  ZSetEditor,
} from "./editors";
import { btnCls, inputCls, useAsyncAction } from "./common";

interface Props {
  selectedKey: string;
  type: RedisType;
  ttl: number | null;
  loading: boolean;
  error: string | null;
  value: ValueView | null;
  onWrite: (op: WriteOp) => Promise<void>;
  onSetTtl: (ttl: number | null) => Promise<void>;
  onDelete: () => Promise<void>;
  /** 手动刷新当前 key 的值（静默，不闪 spinner）。 */
  onRefresh: () => void;
  /** 静默刷新中（按钮转圈用）。 */
  refreshing: boolean;
  /** 是否正在写入（写入中暂停自动刷新，避免与回读竞态）。 */
  writing: boolean;
  /** 自动刷新开关（受控，由标签状态持有）。 */
  auto: boolean;
  /** 自动刷新间隔（秒，受控）。 */
  interval: number;
  onAutoChange: (on: boolean) => void;
  onIntervalChange: (secs: number) => void;
  /** 集合成员总数（null=非集合/无分页）。 */
  total: number | null;
  /** 当前分页位置。 */
  pagePos: PagePos | null;
  /** 下一页位置（null=无更多）。 */
  nextPos: PagePos | null;
  hasPrev: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** 跳到第 n 页（0-based），仅 offset 类型。 */
  onGoto: (n: number) => void;
}

export function ValuePanel({
  selectedKey,
  type,
  ttl,
  loading,
  error,
  value,
  onWrite,
  onSetTtl,
  onDelete,
  onRefresh,
  refreshing,
  writing,
  auto,
  interval,
  onAutoChange,
  onIntervalChange,
  total,
  pagePos,
  nextPos,
  hasPrev,
  onPrev,
  onNext,
  onGoto,
}: Props) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [ttlEditing, setTtlEditing] = useState(false);
  const [ttlDraft, setTtlDraft] = useState("");
  const del = useAsyncAction();
  const { t } = useT();

  // 写入时暂停自动刷新（避免与回读竞态）。选中 key 为空也不启动。
  // auto/interval 受控（来自标签状态）；只挂载 active 标签的 ValuePanel，故仅一个定时器。
  useInterval(
    () => {
      if (writing) return;
      onRefresh();
    },
    auto && selectedKey && interval >= 1 ? interval * 1000 : null,
  );

  // TTL 实时倒计时：以 detail.ttl 为基准，每秒递减；prop 变化（刷新/改 TTL）时重置。
  const [ttlLeft, setTtlLeft] = useState(ttl);
  useEffect(() => setTtlLeft(ttl), [ttl]);
  useInterval(
    () => setTtlLeft((v) => (v == null ? null : v <= 1 ? 0 : v - 1)),
    ttlLeft != null && ttlLeft > 0 ? 1000 : null,
  );

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      {/* 头部：标题行（key + 动作）+ 元信息行 */}
      <div className="space-y-1 border-b border-neutral-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${typeDotClass(type)}`} />
          <div
            className="min-w-0 flex-1 truncate font-mono text-sm text-neutral-100"
            title={selectedKey}
          >
            {selectedKey}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RefreshControls
              auto={auto}
              interval={interval}
              onAutoChange={onAutoChange}
              onIntervalChange={onIntervalChange}
              onRefresh={onRefresh}
              refreshing={refreshing}
              disabled={writing}
            />
            {confirmDel ? (
              <div className="flex items-center gap-1">
                <button
                  disabled={del.busy}
                  className={dangerQuietBtn}
                  onClick={() =>
                    del.run(async () => {
                      await onDelete();
                      setConfirmDel(false);
                    })
                  }
                >
                  {t("确认删除")}
                </button>
                <button className={quietBtn} onClick={() => setConfirmDel(false)}>
                  {t("取消")}
                </button>
              </div>
            ) : (
              <MenuButton
                title={t("更多操作")}
                label={<MoreHorizontal size={15} />}
                options={[
                  {
                    label: t("设 TTL"),
                    onClick: () => {
                      setTtlEditing((v) => !v);
                      setTtlDraft(ttl === null ? "" : String(ttl));
                    },
                  },
                  {
                    label: t("删除"),
                    danger: true,
                    onClick: () => setConfirmDel(true),
                  },
                ]}
              />
            )}
          </div>
        </div>

        {/* 元信息行：类型 · TTL 倒计时 · 总数（· 自动刷新） */}
        <div className="flex items-center gap-2 pl-4 text-xs text-neutral-500">
          <span className="text-neutral-400">{type}</span>
          <span className="text-neutral-500">·</span>
          <span>
            TTL{" "}
            {ttlLeft == null ? (
              t("持久")
            ) : ttlLeft === 0 ? (
              <span className="text-red-400">{t("已过期")}</span>
            ) : (
              <span className={ttlLeft <= 10 ? "text-amber-400" : ""}>{ttlLeft}s</span>
            )}
          </span>
          {total != null && (
            <>
              <span className="text-neutral-500">·</span>
              <span>{t("{n} 条", { n: total.toLocaleString() })}</span>
            </>
          )}
          {auto && <span className="text-emerald-500">{t("· 自动刷新")}</span>}
        </div>

        {ttlEditing && (
          <TtlInline
            ttl={ttl}
            draft={ttlDraft}
            setDraft={setTtlDraft}
            onSetTtl={onSetTtl}
            onDone={() => setTtlEditing(false)}
          />
        )}
      </div>

      {/* 值体 */}
      <div className="min-w-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="text-sm text-neutral-400">{t("读取中…")}</div>
        ) : error ? (
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
            {error}
          </div>
        ) : value ? (
          <ValueBody
            value={value}
            onWrite={onWrite}
            listOffset={pagePos?.by === "offset" ? pagePos.offset : 0}
            redisKey={selectedKey}
          />
        ) : null}
      </div>

      {/* 集合分页栏（大集合翻页，避免全量渲染） */}
      {total != null && (
        <PagerFooter
          type={type}
          total={total}
          pagePos={pagePos}
          nextPos={nextPos}
          hasPrev={hasPrev}
          onPrev={onPrev}
          onNext={onNext}
          onGoto={onGoto}
        />
      )}
    </div>
  );
}

function PagerFooter({
  type,
  total,
  pagePos,
  nextPos,
  hasPrev,
  onPrev,
  onNext,
  onGoto,
}: {
  type: RedisType;
  total: number;
  pagePos: PagePos | null;
  nextPos: PagePos | null;
  hasPrev: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGoto: (n: number) => void;
}) {
  const { t } = useT();
  const isOffset = pagePos?.by === "offset";
  const currentPage = isOffset ? Math.floor(pagePos.offset / VALUE_PAGE) + 1 : 1;
  const totalPages = Math.max(1, Math.ceil(total / VALUE_PAGE));
  const approx = type === "hash" || type === "set"; // SCAN 游标分页，计数为精确但遍历可能重复
  const [pageInput, setPageInput] = useState(String(currentPage));
  useEffect(() => setPageInput(String(currentPage)), [currentPage]);

  const btn =
    "rounded border border-neutral-700 px-2 py-0.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-40";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-neutral-800 px-3 py-1.5 text-xs text-neutral-400">
      <span>
        {approx ? `${t("约")} ` : ""}
        {t("{n} 条", { n: total.toLocaleString() })}
      </span>
      <button onClick={onPrev} disabled={!hasPrev} className={btn}>
        {t("‹ 上一页")}
      </button>
      {isOffset ? (
        <span className="flex items-center gap-1">
          {t("第")}
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = Number(pageInput);
                if (n >= 1 && n <= totalPages) onGoto(n - 1);
              }
            }}
            className="w-14 rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-center text-neutral-100"
          />
          / {totalPages} {t("页")}
        </span>
      ) : (
        <span>{nextPos ? t("可继续加载") : t("已全部")}</span>
      )}
      <button onClick={onNext} disabled={!nextPos} className={btn}>
        {t("下一页 ›")}
      </button>
    </div>
  );
}

function TtlInline({
  ttl,
  draft,
  setDraft,
  onSetTtl,
  onDone,
}: {
  ttl: number | null;
  draft: string;
  setDraft: (s: string) => void;
  onSetTtl: (t: number | null) => Promise<void>;
  onDone: () => void;
}) {
  const act = useAsyncAction();
  const { t } = useT();
  return (
    <div className="mt-2 flex items-center gap-1">
      <input
        className={inputCls + " w-24"}
        type="number"
        placeholder={t("秒")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        disabled={act.busy}
        className={btnCls}
        onClick={() =>
          act.run(async () => {
            await onSetTtl(draft === "" ? 0 : Number(draft));
            onDone();
          })
        }
      >
        {t("设为")}
      </button>
      <button
        className={btnCls}
        onClick={() => act.run(async () => { await onSetTtl(null); onDone(); })}
      >
        {t("设为持久")}
      </button>
      <button className={btnCls} onClick={onDone}>
        {t("取消")}
      </button>
      {act.error && <span className="text-xs text-red-400">{act.error}</span>}
      {ttl !== null && (
        <span className="text-xs text-neutral-600">{t("当前")} {ttl}s</span>
      )}
    </div>
  );
}

function ValueBody({
  value,
  onWrite,
  listOffset,
  redisKey,
}: {
  value: ValueView;
  onWrite: (op: WriteOp) => Promise<void>;
  listOffset: number;
  redisKey: string;
}) {
  switch (value.kind) {
    case "string":
      return <StringEditor value={value} onWrite={onWrite} />;
    case "hash":
      return <HashEditor value={value} onWrite={onWrite} />;
    case "list":
      return <ListEditor value={value} onWrite={onWrite} offset={listOffset} />;
    case "set":
      return <SetEditor value={value} onWrite={onWrite} />;
    case "z_set":
      return <ZSetEditor value={value} onWrite={onWrite} />;
    case "stream":
      return <StreamViewer value={value} redisKey={redisKey} />;
    case "unknown":
      return (
        <pre className="whitespace-pre-wrap break-all rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
          {value.raw}
        </pre>
      );
  }
}
