// 连接管理状态（基于 React Context，不引外部状态库，贴合"轻量"目标）。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConnectionConfig, ServerInfo } from "../types";
import { ipc } from "../lib/ipc";

export type ConnStatus = "idle" | "connecting" | "connected" | "error";
/** 后端健康探测推送的连接态（仅对活跃连接有意义）。 */
export type ConnHealth = "ok" | "reconnecting" | "down";

interface ConnectionsContextValue {
  configs: ConnectionConfig[];
  activeId: string | null;
  serverInfo: ServerInfo | null;
  status: ConnStatus;
  error: string | null;
  /** 活跃连接的实时健康态（来自后端周期 ping → conn-health 事件）。 */
  health: ConnHealth;
  refresh: () => Promise<void>;
  /** 直接替换内存中的连接列表（供 useGroups 在 rename/delete 后回写后端返回的快照）。 */
  setConfigs: (next: ConnectionConfig[]) => void;
  save: (config: ConnectionConfig) => Promise<string>;
  remove: (id: string) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** 当前逻辑 DB（连接时初始化为配置 db，切换时更新）。 */
  db: number;
  dbError: string | null;
  setDb: (db: number) => Promise<void>;
}

const ConnectionsContext = createContext<ConnectionsContextValue | null>(null);

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const [configs, setConfigs] = useState<ConnectionConfig[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [db, setDbState] = useState(0);
  const [dbError, setDbError] = useState<string | null>(null);
  const [health, setHealth] = useState<ConnHealth>("ok");

  const refresh = useCallback(async () => {
    setConfigs(await ipc.listConnections());
  }, []);

  // 启动时拉一次已保存的连接
  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (config: ConnectionConfig) => {
      const id = await ipc.saveConnection(config);
      await refresh();
      return id;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (activeId === id) {
        setActiveId(null);
        setServerInfo(null);
        setStatus("idle");
        setError(null);
        setDbState(0);
        setDbError(null);
      }
      await ipc.deleteConnection(id);
      await refresh();
    },
    [activeId, refresh],
  );

  const connect = useCallback(async (id: string) => {
    setStatus("connecting");
    setError(null);
    setHealth("ok");
    try {
      const info = await ipc.connect(id);
      setActiveId(id);
      setServerInfo(info);
      setStatus("connected");
      setHealth("ok");
      setDbState(configs.find((c) => c.id === id)?.db ?? 0);
      setDbError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (activeId) {
      await ipc.disconnect(activeId);
    }
    setActiveId(null);
    setServerInfo(null);
    setStatus("idle");
    setError(null);
    setHealth("ok");
    setDbState(0);
    setDbError(null);
  }, [activeId]);

  // 监听后端健康探测事件（按当前活跃连接过滤）。后端周期 ping，状态变化时推送。
  useEffect(() => {
    if (!activeId) return;
    let un: UnlistenFn | undefined;
    let alive = true;
    void listen<{ id: string; state: string; latency: number | null }>(
      "conn-health",
      (e) => {
        if (e.payload.id === activeId) {
          const s = e.payload.state;
          setHealth(s === "down" || s === "reconnecting" ? (s as ConnHealth) : "ok");
        }
      },
    ).then((u) => {
      if (alive) un = u;
      else u();
    });
    return () => {
      alive = false;
      un?.();
    };
  }, [activeId]);

  // 切换逻辑 DB（SELECT）。仅 standalone；集群会由后端拒绝并回错到 dbError。
  const setDb = useCallback(
    async (n: number) => {
      if (!activeId) return;
      try {
        await ipc.selectDb(activeId, n);
        setDbState(n);
        setDbError(null);
      } catch (e) {
        setDbError(e instanceof Error ? e.message : String(e));
      }
    },
    [activeId],
  );

  const value: ConnectionsContextValue = {
    configs,
    activeId,
    serverInfo,
    status,
    error,
    health,
    refresh,
    setConfigs,
    save,
    remove,
    connect,
    disconnect,
    db,
    dbError,
    setDb,
  };

  return (
    <ConnectionsContext.Provider value={value}>
      {children}
    </ConnectionsContext.Provider>
  );
}

export function useConnections() {
  const ctx = useContext(ConnectionsContext);
  if (!ctx) {
    throw new Error("useConnections 必须在 <ConnectionsProvider> 内使用");
  }
  return ctx;
}
