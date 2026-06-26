// 分组管理状态（镜像 useConnections 的 Context + useState + 显式 refresh 模式）。
// rename/delete 后端返回受影响的全量连接快照 → 经 useConnections.setConfigs 回写，
// 避免两个 Context 互相 refresh 造成循环依赖，并省一次 IPC 往返。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { GroupMeta } from "../types";
import { ipc } from "../lib/ipc";
import { useConnections } from "./useConnections";

interface GroupsContextValue {
  groups: GroupMeta[];
  refresh: () => Promise<void>;
  upsert: (g: GroupMeta) => Promise<void>;
  remove: (name: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  /** 移动连接到分组（内部会刷新连接列表；GroupMeta 不变）。 */
  moveConnection: (id: string, group: string | null) => Promise<void>;
}

const GroupsContext = createContext<GroupsContextValue | null>(null);

export function GroupsProvider({ children }: { children: ReactNode }) {
  const { setConfigs, refresh: refreshConfigs } = useConnections();
  const [groups, setGroups] = useState<GroupMeta[]>([]);

  const refresh = useCallback(async () => {
    setGroups(await ipc.listGroups());
  }, []);

  // 启动时拉一次分组（后端兜底保证默认组始终存在）
  useEffect(() => {
    refresh();
  }, [refresh]);

  const upsert = useCallback(
    async (g: GroupMeta) => {
      await ipc.upsertGroup(g);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (name: string) => {
      // 后端已把组内连接移到默认组，返回新快照 → 直接回写连接列表
      const configs = await ipc.deleteGroup(name);
      setConfigs(configs);
      await refresh();
    },
    [refresh, setConfigs],
  );

  const rename = useCallback(
    async (from: string, to: string) => {
      // 后端级联改了连接 group，返回新快照 → 直接回写连接列表
      const configs = await ipc.renameGroup(from, to);
      setConfigs(configs);
      await refresh();
    },
    [refresh, setConfigs],
  );

  const moveConnection = useCallback(
    async (id: string, group: string | null) => {
      await ipc.moveConnection(id, group);
      // move 只改连接的 group（GroupMeta 不变）→ 刷新连接列表即可
      await refreshConfigs();
    },
    [refreshConfigs],
  );

  const value: GroupsContextValue = {
    groups,
    refresh,
    upsert,
    remove,
    rename,
    moveConnection,
  };

  return (
    <GroupsContext.Provider value={value}>{children}</GroupsContext.Provider>
  );
}

export function useGroups() {
  const ctx = useContext(GroupsContext);
  if (!ctx) {
    throw new Error("useGroups 必须在 <GroupsProvider> 内使用");
  }
  return ctx;
}
