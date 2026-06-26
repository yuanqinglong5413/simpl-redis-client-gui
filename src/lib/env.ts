// 当前连接的「分组环境」派生：activeId → config.group → GroupMeta.environment。
// 用于 Prod 安全联动（危险操作强确认）。无活跃连接或组未加载 → "dev"（默认不触发强确认）。
import type { ConnectionConfig, GroupEnv, GroupMeta } from "../types";
import { DEFAULT_GROUP } from "../types";
import { useConnections } from "../hooks/useConnections";
import { useGroups } from "../hooks/useGroups";

/** 连接所属分组名（null → 默认组内部 key）。 */
export function groupOf(c: ConnectionConfig): string {
  return c.group ?? DEFAULT_GROUP;
}

/** 该连接是否属于生产环境分组。 */
export function isProdEnv(c: ConnectionConfig, groups: GroupMeta[]): boolean {
  return groups.find((g) => g.name === groupOf(c))?.environment === "prod";
}

/** 当前活跃连接的环境；无活跃连接或组未加载 → "dev"。 */
export function useActiveEnv(): GroupEnv {
  const { configs, activeId } = useConnections();
  const { groups } = useGroups();
  const c = configs.find((x) => x.id === activeId);
  if (!c) return "dev";
  return groups.find((g) => g.name === groupOf(c))?.environment ?? "dev";
}
