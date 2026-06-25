// Pub/Sub 面板：订阅频道/模式 + 实时消息流 + 发布；底部 MONITOR 监听全部命令流。
// 消息经 Tauri 事件 `pubsub-message` / `monitor-command` 推送，按 activeId 过滤。
// 缓冲上限 CAP，避免长时间高频流撑爆内存/DOM。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Loader2, Radio, Send, Trash2 } from "lucide-react";
import { ipc } from "../lib/ipc";
import type { MonitorCommand, PubsubMessage } from "../types";
import { useT } from "../i18n";
import { Segmented, Toolbar } from "./ui";
import { btnCls, inputCls, useAsyncAction } from "./value/common";

/** 消息/命令缓冲上限（超出按时间丢弃最旧的）。 */
const CAP = 500;

interface Msg extends PubsubMessage {
  /** 前端接收时刻（pubsub 消息无服务端时间戳）。 */
  at: number;
}

export function PubSubPanel({ activeId }: { activeId: string }) {
  const { t } = useT();
  // 订阅输入
  const [subInput, setSubInput] = useState("");
  const [mode, setMode] = useState<"channel" | "pattern">("channel");
  // 本地维护的订阅列表
  const [channels, setChannels] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  // 消息流 / MONITOR 命令流
  const [messages, setMessages] = useState<Msg[]>([]);
  const [cmds, setCmds] = useState<MonitorCommand[]>([]);
  // 发布
  const [pubCh, setPubCh] = useState("");
  const [pubMsg, setPubMsg] = useState("");
  const [pubInfo, setPubInfo] = useState<string | null>(null);
  // MONITOR 开关
  const [monitoring, setMonitoring] = useState(false);
  const sub = useAsyncAction();
  const unsub = useAsyncAction();
  const pub = useAsyncAction();
  const mon = useAsyncAction();

  // 监听后端事件（按 activeId 过滤）；切连接时重挂（key={activeId}）会重建。
  useEffect(() => {
    let un1: UnlistenFn | undefined;
    let un2: UnlistenFn | undefined;
    let alive = true;
    void listen<PubsubMessage>("pubsub-message", (e) => {
      if (e.payload.id === activeId) {
        setMessages((prev) => [{ ...e.payload, at: Date.now() }, ...prev].slice(0, CAP));
      }
    }).then((u) => {
      if (alive) un1 = u;
      else u();
    });
    void listen<MonitorCommand>("monitor-command", (e) => {
      if (e.payload.id === activeId) {
        setCmds((prev) => [e.payload, ...prev].slice(0, CAP));
      }
    }).then((u) => {
      if (alive) un2 = u;
      else u();
    });
    return () => {
      alive = false;
      un1?.();
      un2?.();
    };
  }, [activeId]);

  // 组件卸载：若 MONITOR 还开着，停掉（避免后台空跑）。
  const monitoringRef = useRef(monitoring);
  monitoringRef.current = monitoring;
  useEffect(() => {
    return () => {
      if (monitoringRef.current) void ipc.monitorStop(activeId);
    };
  }, [activeId]);

  const doSubscribe = () =>
    sub.run(async () => {
      const v = subInput.trim();
      if (!v) return;
      if (mode === "channel") {
        await ipc.pubsubSubscribe(activeId, [v], []);
        setChannels((p) => (p.includes(v) ? p : [...p, v]));
      } else {
        await ipc.pubsubSubscribe(activeId, [], [v]);
        setPatterns((p) => (p.includes(v) ? p : [...p, v]));
      }
      setSubInput("");
    });

  const doUnsubscribe = (which: "channel" | "pattern", name: string) =>
    unsub.run(async () => {
      if (which === "channel") {
        await ipc.pubsubUnsubscribe(activeId, [name], []);
        setChannels((p) => p.filter((c) => c !== name));
      } else {
        await ipc.pubsubUnsubscribe(activeId, [], [name]);
        setPatterns((p) => p.filter((c) => c !== name));
      }
    });

  const doPublish = () =>
    pub.run(async () => {
      const ch = pubCh.trim();
      if (!ch) return;
      const n = await ipc.pubsubPublish(activeId, ch, pubMsg);
      setPubInfo(t("已送达 {n} 个订阅者", { n }));
    });

  const toggleMonitor = () =>
    mon.run(async () => {
      if (monitoring) {
        await ipc.monitorStop(activeId);
        setMonitoring(false);
      } else {
        await ipc.monitorStart(activeId);
        setMonitoring(true);
      }
    });

  return (
    <div className="flex h-full flex-col">
      <Toolbar className="gap-2">
        <input
          className={`${inputCls} w-auto flex-1`}
          value={subInput}
          onChange={(e) => setSubInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void doSubscribe();
          }}
          placeholder={mode === "channel" ? t("频道名，如 news") : t("模式，如 news.*")}
        />
        <Segmented
          value={mode}
          onChange={(m) => setMode(m)}
          title={t("订阅类型")}
          options={[
            { value: "channel", label: t("频道") },
            { value: "pattern", label: t("模式") },
          ]}
        />
        <button
          onClick={() => void doSubscribe()}
          disabled={sub.busy || !subInput.trim()}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
        >
          {sub.busy ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />}
          {t("订阅")}
        </button>
      </Toolbar>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-sm">
        {/* 订阅列表 */}
        <section>
          <SectionTitle>{t("订阅列表")}</SectionTitle>
          {channels.length + patterns.length === 0 ? (
            <p className="text-xs text-neutral-600">{t("无订阅")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {channels.map((c) => (
                <Chip key={`c:${c}`} label={c} kind="channel" onRemove={() => void doUnsubscribe("channel", c)} />
              ))}
              {patterns.map((p) => (
                <Chip key={`p:${p}`} label={p} kind="pattern" onRemove={() => void doUnsubscribe("pattern", p)} />
              ))}
            </div>
          )}
        </section>

        {/* 发布 */}
        <section>
          <SectionTitle>{t("发布消息")}</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            <input
              className={`${inputCls} w-auto`}
              placeholder={t("频道")}
              value={pubCh}
              onChange={(e) => setPubCh(e.target.value)}
            />
            <input
              className={`${inputCls} w-auto flex-1 min-w-[160px]`}
              placeholder={t("消息内容")}
              value={pubMsg}
              onChange={(e) => setPubMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doPublish();
              }}
            />
            <button
              onClick={() => void doPublish()}
              disabled={pub.busy || !pubCh.trim()}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-700 px-3 py-1 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
            >
              {pub.busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {t("发布")}
            </button>
          </div>
          {pubInfo && <p className="mt-1 text-xs text-emerald-400">{pubInfo}</p>}
          {pub.error && <p className="mt-1 text-xs text-red-400">{t("发布失败")}：{pub.error}</p>}
        </section>

        {/* 消息流 */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <SectionTitle className="mb-0">
              {t("消息")} <span className="text-neutral-600">({messages.length})</span>
            </SectionTitle>
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} className={btnCls}>
                {t("清空")}
              </button>
            )}
          </div>
          {messages.length === 0 ? (
            <p className="text-xs text-neutral-600">{t("暂无消息")}</p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs">
              {messages.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 text-neutral-600">{fmtTime(m.at)}</span>
                  {m.kind === "pmessage" && (
                    <span className="shrink-0 rounded bg-amber-600/20 px-1 text-amber-300">P</span>
                  )}
                  <span className="shrink-0 text-sky-400">{m.channel}</span>
                  <span className="min-w-0 break-all text-neutral-200">{m.value}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* MONITOR */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <SectionTitle className="mb-0">MONITOR</SectionTitle>
            <button
              onClick={() => void toggleMonitor()}
              disabled={mon.busy}
              className={`inline-flex items-center gap-1 rounded-md border px-3 py-1 text-xs disabled:opacity-50 ${
                monitoring
                  ? "border-red-900/60 text-red-300 hover:bg-red-950/40"
                  : "border-neutral-700 text-neutral-200 hover:bg-neutral-800"
              }`}
            >
              {mon.busy ? <Loader2 size={12} className="animate-spin" /> : <Radio size={12} />}
              {monitoring ? t("停止") : t("开启")}
            </button>
          </div>
          <p className="mb-1 text-[11px] text-amber-400/80">
            {t("MONITOR 仅支持单机/哨兵模式；会显著增加服务器负载，按需开启。")}
          </p>
          {cmds.length === 0 ? (
            <p className="text-xs text-neutral-600">{t("暂无命令")}</p>
          ) : (
            <div className="max-h-60 space-y-1 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs">
              {cmds.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 text-neutral-600">db{c.db}</span>
                  <span className="min-w-0 flex-1 break-all text-neutral-200">{c.command}</span>
                  <span className="shrink-0 text-neutral-600">{c.client}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionTitle({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h4 className={`mb-1.5 text-xs font-medium text-neutral-400 ${className}`}>{children}</h4>
  );
}

function Chip({
  label,
  kind,
  onRemove,
}: {
  label: string;
  kind: "channel" | "pattern";
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200">
      {kind === "pattern" && <span className="text-amber-400">P</span>}
      <span className="break-all">{label}</span>
      <button
        onClick={onRemove}
        className="text-neutral-500 hover:text-red-300"
        title="unsubscribe"
      >
        <Trash2 size={11} />
      </button>
    </span>
  );
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
