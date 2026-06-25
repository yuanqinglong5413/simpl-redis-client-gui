// Stream 消费组管理：列出组（XINFO GROUPS）+ 新建/删除组 + 待处理条目（XPENDING）+ 确认（XACK）。
// 连续消费（XREADGROUP）/ XCLAIM 暂未做（GUI 常见诉求是「看组、看堆积、ack 卡住消息」）。
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { ipc } from "../../lib/ipc";
import type { PendingEntry, StreamGroupInfo } from "../../types";
import { useT } from "../../i18n";
import { btnCls, dangerBtnCls, inputCls, useAsyncAction } from "./common";

interface Props {
  activeId: string | null;
  redisKey: string;
}

/** XPENDING 详式拉取上限。 */
const PENDING_LIMIT = 100;

export function StreamGroups({ activeId, redisKey }: Props) {
  const { t } = useT();
  const [groups, setGroups] = useState<StreamGroupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 新建组表单
  const [gName, setGName] = useState("");
  const [gStart, setGStart] = useState("$");
  const [mkstream, setMkstream] = useState(false);
  const create = useAsyncAction();
  // 每个组展开的待处理条目
  const [pendingMap, setPendingMap] = useState<Record<string, PendingEntry[]>>({});

  const reload = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    setError(null);
    try {
      setGroups(await ipc.streamGroups(activeId, redisKey));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeId, redisKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const doCreate = () =>
    create.run(async () => {
      if (!activeId || !gName.trim()) return;
      await ipc.createGroup(activeId, redisKey, gName.trim(), gStart.trim() || "$", mkstream);
      setGName("");
      await reload();
    });

  const doDestroy = async (name: string) => {
    if (!activeId) return;
    await ipc.destroyGroup(activeId, redisKey, name);
    await reload();
  };

  const togglePending = async (name: string) => {
    if (!activeId) return;
    if (pendingMap[name]) {
      // 已展开 → 收起
      setPendingMap((m) => {
        const next = { ...m };
        delete next[name];
        return next;
      });
      return;
    }
    try {
      const entries = await ipc.streamPending(activeId, redisKey, name, PENDING_LIMIT);
      setPendingMap((m) => ({ ...m, [name]: entries }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doAck = async (name: string, id: string) => {
    if (!activeId) return;
    await ipc.streamAck(activeId, redisKey, name, [id]);
    // 刷新该组待处理 + 组列表（pending 计数会变）
    try {
      const entries = await ipc.streamPending(activeId, redisKey, name, PENDING_LIMIT);
      setPendingMap((m) => ({ ...m, [name]: entries }));
    } catch {
      /* ignore */
    }
    await reload();
  };

  if (!activeId) return null;

  return (
    <div className="space-y-3">
      {/* 工具行：刷新 + 新建组表单 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => void reload()} disabled={loading} className={btnCls}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {t("刷新")}
        </button>
        <input
          className={`${inputCls} w-auto`}
          placeholder={t("组名")}
          value={gName}
          onChange={(e) => setGName(e.target.value)}
        />
        <input
          className={`${inputCls} w-auto`}
          placeholder={t("起始 id（$ 仅新 / 0 全部）")}
          value={gStart}
          onChange={(e) => setGStart(e.target.value)}
          title="$ = 仅新消息；0 = 全部历史"
        />
        <label className="flex items-center gap-1 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={mkstream}
            onChange={(e) => setMkstream(e.target.checked)}
            className="accent-red-600"
          />
          MKSTREAM
        </label>
        <button
          onClick={() => void doCreate()}
          disabled={create.busy || !gName.trim()}
          className={btnCls}
        >
          {create.busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          {t("新建组")}
        </button>
      </div>
      {create.error && <p className="text-xs text-red-400">{create.error}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* 组列表 */}
      {!loading && groups.length === 0 && !error ? (
        <p className="text-xs text-neutral-500">{t("无消费组")}</p>
      ) : (
        groups.map((g) => (
          <GroupCard
            key={g.name}
            group={g}
            pending={pendingMap[g.name]}
            onTogglePending={() => void togglePending(g.name)}
            onAck={(id) => void doAck(g.name, id)}
            onDestroy={() => void doDestroy(g.name)}
          />
        ))
      )}
    </div>
  );
}

function GroupCard({
  group,
  pending,
  onTogglePending,
  onAck,
  onDestroy,
}: {
  group: StreamGroupInfo;
  pending?: PendingEntry[];
  onTogglePending: () => void;
  onAck: (id: string) => void;
  onDestroy: () => void;
}) {
  const { t } = useT();
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-sm text-sky-400">{group.name}</span>
        <span className="text-xs text-neutral-500">
          {t("消费者")} {group.consumers} · {t("待处理")} {group.pending}
          {group.lag != null ? ` · lag ${group.lag}` : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-600" title={group.last_delivered_id}>
          {group.last_delivered_id || "—"}
        </span>
        <button onClick={onTogglePending} className={btnCls}>
          {t("待处理")}
        </button>
        {confirmDel ? (
          <>
            <button onClick={onDestroy} className={dangerBtnCls}>
              {t("确认删除")}
            </button>
            <button onClick={() => setConfirmDel(false)} className={btnCls}>
              {t("取消")}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDel(true)}
            title={t("删除组")}
            className={dangerBtnCls}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {pending && (
        <div className="mt-2">
          {pending.length === 0 ? (
            <p className="text-xs text-neutral-600">{t("无待处理")}</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-neutral-500">
                  <th className="px-2 py-1">ID</th>
                  <th className="px-2 py-1">{t("消费者")}</th>
                  <th className="px-2 py-1">{t("空闲(ms)")}</th>
                  <th className="px-2 py-1">{t("投递")}</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.id} className="border-b border-neutral-800/40">
                    <td className="break-all px-2 py-1 font-mono text-neutral-300">{p.id}</td>
                    <td className="px-2 py-1 text-neutral-400">{p.consumer}</td>
                    <td className="px-2 py-1 text-neutral-400">{p.idle_ms}</td>
                    <td className="px-2 py-1 text-neutral-400">{p.deliveries}</td>
                    <td className="px-2 py-1">
                      <button onClick={() => onAck(p.id)} className={btnCls}>
                        Ack
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
