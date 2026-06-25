// Tauri IPC 的类型化封装。命令名沿用 Rust 侧的 snake_case。
import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  KeyDetail,
  MemAnalysis,
  PagePos,
  PatternStats,
  PendingEntry,
  RedisType,
  ScanPage,
  ServerInfo,
  ServerStats,
  SlowEntry,
  StreamGroupInfo,
  ValuePage,
  WriteOp,
} from "../types";

interface PingResponse {
  message: string;
  version: string;
  core_linked: boolean;
}

export const ipc = {
  ping: () => invoke<PingResponse>("ping"),

  listConnections: () => invoke<ConnectionConfig[]>("list_connections"),

  /** 新建（id 空）/ 更新。返回最终 id。 */
  saveConnection: (config: ConnectionConfig) =>
    invoke<string>("save_connection", { config }),

  deleteConnection: (id: string) => invoke<void>("delete_connection", { id }),

  /** 测试连通（不落盘、不查钥匙串，用表单当前密码直连）。 */
  testConnection: (config: ConnectionConfig) =>
    invoke<ServerInfo>("test_connection", { config }),

  /** 建立活跃连接（密码经钥匙串取回）。 */
  connect: (id: string) => invoke<ServerInfo>("connect", { id }),

  disconnect: (id: string) => invoke<void>("disconnect", { id }),

  dbsize: (id: string) => invoke<number>("dbsize", { id }),

  scanKeys: (
    id: string,
    cursor: number,
    pattern: string | null,
    count: number,
    ty: RedisType | null,
  ) => invoke<ScanPage>("scan_keys", { id, cursor, pattern, count, ty }),

  getKeyDetail: (id: string, key: string) =>
    invoke<KeyDetail>("get_key_detail", { id, key }),

  /** 读集合的一页（分页）。 */
  readValuePage: (
    id: string,
    key: string,
    ty: RedisType,
    pos: PagePos,
    limit: number,
  ) => invoke<ValuePage>("read_value_page", { id, key, ty, pos, limit }),

  selectDb: (id: string, db: number) =>
    invoke<void>("select_db", { id, db }),

  writeKey: (id: string, key: string, op: WriteOp) =>
    invoke<void>("write_key", { id, key, op }),

  setTtl: (id: string, key: string, ttl: number | null) =>
    invoke<void>("set_ttl", { id, key, ttl }),

  deleteKey: (id: string, key: string) =>
    invoke<boolean>("delete_key", { id, key }),

  /** 单 key 占用字节数（MEMORY USAGE）；None=缺失/不可用。 */
  keyMemoryUsage: (id: string, key: string) =>
    invoke<number | null>("key_memory_usage", { id, key }),

  /** 命名空间（pattern）统计：key 数 + 总字节。 */
  patternStats: (id: string, pattern: string) =>
    invoke<PatternStats>("pattern_stats", { id, pattern }),

  /** 删除匹配 pattern 的全部 key（UNLINK），返回删除数。危险。 */
  deleteByPattern: (id: string, pattern: string) =>
    invoke<number>("delete_by_pattern", { id, pattern }),

  /** 重命名 key（RENAME）。 */
  renameKey: (id: string, src: string, dst: string) =>
    invoke<void>("rename_key", { id, src, dst }),

  /** 复制 key（COPY，Redis 6.2+）；replace=true 覆盖已存在目标。 */
  copyKey: (id: string, src: string, dst: string, replace: boolean) =>
    invoke<boolean>("copy_key", { id, src, dst, replace }),

  /** 对匹配 pattern 的全部 key 批量设 TTL（null=取消过期 PERSIST），返回处理数。危险。 */
  setTtlByPattern: (id: string, pattern: string, ttl: number | null) =>
    invoke<number>("set_ttl_by_pattern", { id, pattern, ttl }),

  /** 整库内存分析：key 总数 + 总字节 + 占用 top-N（扫当前 db）。 */
  analyzeMemory: (id: string, limit: number) =>
    invoke<MemAnalysis>("analyze_memory", { id, limit }),

  /** 服务器实时统计（INFO）。 */
  serverStats: (id: string) => invoke<ServerStats>("server_stats", { id }),

  /** 慢日志（SLOWLOG GET）。 */
  slowlog: (id: string, limit: number) =>
    invoke<SlowEntry[]>("slowlog", { id, limit }),

  execCommand: (id: string, args: string[]) =>
    invoke<string>("exec_command", { id, args }),

  /** 订阅频道（SUBSCRIBE）和/或模式（PSUBSCRIBE）。 */
  pubsubSubscribe: (id: string, channels: string[], patterns: string[]) =>
    invoke<void>("pubsub_subscribe", { id, channels, patterns }),

  /** 取消订阅。 */
  pubsubUnsubscribe: (id: string, channels: string[], patterns: string[]) =>
    invoke<void>("pubsub_unsubscribe", { id, channels, patterns }),

  /** 发布消息（PUBLISH），返回收到该消息的订阅客户端数。 */
  pubsubPublish: (id: string, channel: string, message: string) =>
    invoke<number>("pubsub_publish", { id, channel, message }),

  /** 开启 MONITOR（独立连接）。 */
  monitorStart: (id: string) => invoke<void>("monitor_start", { id }),

  /** 停止 MONITOR。 */
  monitorStop: (id: string) => invoke<void>("monitor_stop", { id }),

  /** Stream 消费组列表（XINFO GROUPS）。 */
  streamGroups: (id: string, key: string) =>
    invoke<StreamGroupInfo[]>("stream_groups", { id, key }),

  /** 新建消费组（XGROUP CREATE）。startId 通常 "$"（仅新）或 "0"（全部历史）。 */
  createGroup: (id: string, key: string, group: string, startId: string, mkstream: boolean) =>
    invoke<void>("create_group", { id, key, group, startId, mkstream }),

  /** 删除消费组（XGROUP DESTROY）。破坏性。 */
  destroyGroup: (id: string, key: string, group: string) =>
    invoke<void>("destroy_group", { id, key, group }),

  /** 确认消息（XACK），返回确认条数。 */
  streamAck: (id: string, key: string, group: string, entryIds: string[]) =>
    invoke<number>("stream_ack", { id, key, group, entryIds }),

  /** 消费组待处理条目（XPENDING 详式，前 count 条）。 */
  streamPending: (id: string, key: string, group: string, count: number) =>
    invoke<PendingEntry[]>("stream_pending", { id, key, group, count }),
};
