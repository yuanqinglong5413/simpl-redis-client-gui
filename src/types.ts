// 前后端共享领域类型。字段名与 Rust 端结构**完全一致**（Rust 侧无 serde rename_all）。

/**
 * 连接配置。
 * 注意：`password` 仅在「新建/编辑 → save」方向由前端发送；
 * `list_connections` 的响应中**不包含** password（Rust 侧 skip_serializing）。
 */
export interface ConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string | null;
  /** 仅 save 输入方向；list 响应中不存在。空串 = 保留现有钥匙串密码。 */
  password?: string | null;
  db: number;
  tls: boolean;
  group: string | null;
  /** 连接级浏览偏好（每页数/分隔符/默认视图/自动刷新间隔）。缺省 = 用默认值。 */
  prefs?: ConnPrefs;
  /** SSH 隧道（可选，经堡垒机连内网 Redis）。镜像 Rust SshTunnelConfig。 */
  ssh?: SshTunnelConfig | null;
  /** 最近一次成功连接的 Unix 秒；侧栏「最近使用置顶」排序用。老连接 = null。 */
  last_used_at?: number | null;
}

/** 默认分组内部 key（后端不 i18n）；展示时翻译为「默认 / Default」。镜像 Rust DEFAULT_GROUP。 */
export const DEFAULT_GROUP = "__default__";

/** 分组环境标识。镜像 Rust GroupEnv（serde 小写）。Prod 触发前端危险操作强确认。 */
export type GroupEnv = "dev" | "staging" | "prod";

/** 连接分组元数据。连接用 ConnectionConfig.group 名字弱引用，故 name 为唯一键。
 *  镜像 Rust GroupMeta（字段全 #[serde(default)]）。 */
export interface GroupMeta {
  name: string;
  environment: GroupEnv;
  order: number;
  color: string | null;
  note: string | null;
  created_at: number;
}

/**
 * SSH 隧道配置（堡垒机）。auth 用扁平结构（kind 决定用哪几个字段），
 * 与 Rust 端 tagged enum 经 serde 兼容（多余字段被忽略）。
 * 敏感字段（password/passphrase）仅 save 输入方向发送；list 响应中不存在。
 */
export interface SshTunnelConfig {
  host: string;
  port: number;
  user: string;
  auth: {
    kind: "password" | "private_key";
    /** kind=password 时用。 */
    password?: string | null;
    /** kind=private_key 时用：私钥文件路径。 */
    key_path?: string;
    /** kind=private_key 时用：私钥口令（可选）。 */
    passphrase?: string | null;
  };
}

/**
 * 连接级浏览偏好。字段全可选，缺省由 connPrefs 解析器套默认值。
 * 镜像 Rust ConnPrefs（全 #[serde(default)]）。
 */
export interface ConnPrefs {
  /** SCAN COUNT 每页数；<1 或缺省 => 200。 */
  scan_count?: number;
  /** 树视图分隔符；缺省 => ":"；"" => 不分组（全平铺）。 */
  key_separator?: string;
  /** 默认浏览视图 "flat" | "tree"；非上述或缺省 => "tree"。 */
  default_view?: "flat" | "tree";
  /** 值面板自动刷新间隔（秒）；缺省 => 2；0 => 关闭。 */
  auto_refresh_secs?: number;
}

/** 服务器简要信息（ping/INFO 解析）。 */
export interface ServerInfo {
  reachable: boolean;
  version: string | null;
  mode: string | null;
}

/** 用于新建连接时的空表单（id 留空，后端生成）。 */
export function emptyConnection(): ConnectionConfig {
  return {
    id: "",
    name: "",
    host: "127.0.0.1",
    port: 6379,
    username: null,
    password: "",
    db: 0,
    tls: false,
    group: null,
    prefs: {},
    last_used_at: null,
  };
}

// ===== M2 Key 浏览 =====

/** Redis 数据类型（与 Rust RedisType 对应，serde 小写）。 */
export type RedisType =
  | "string"
  | "hash"
  | "list"
  | "set"
  | "zset"
  | "stream"
  | "none"
  | "unknown";

/** Key 列表一行（SCAN + TYPE + TTL）。 */
export interface KeyBrief {
  key: string;
  type: RedisType;
  /** TTL（秒）；null = 持久（无过期）。 */
  ttl: number | null;
}

/** SCAN 一页结果。next_cursor 为 0 表示遍历完毕。 */
export interface ScanPage {
  next_cursor: number;
  keys: KeyBrief[];
}

/** 单 key 完整详情：类型 + TTL + 值（刷新三者一起更新）。镜像 Rust KeyDetail。
 *  集合类型的 value 是**首页**（分页）；total=成员总数，next_pos=下一页位置（null=无更多）。 */
export interface KeyDetail {
  type: RedisType;
  ttl: number | null;
  total: number | null;
  next_pos: PagePos | null;
  value: ValueView;
}

/** 分页位置（按类型语义不同）。镜像 Rust PagePos。 */
export type PagePos =
  | { by: "offset"; offset: number } // list / zset
  | { by: "cursor"; cursor: number } // hash / set
  | { by: "after_id"; id: string }; // stream

/** 一页集合值 + 下一页位置（null=到底）。 */
export interface ValuePage {
  value: ValueView;
  next: PagePos | null;
}

/** 命名空间（pattern）统计：匹配 key 数 + 总字节。镜像 Rust PatternStats。 */
export interface PatternStats {
  count: number;
  bytes: number;
}

/** 单 key 内存占用统计（最大 key 分析用）。镜像 Rust KeyMemStat。 */
export interface KeyMemStat {
  key: string;
  type: RedisType;
  ttl: number | null;
  bytes: number;
}

/** 整库内存分析结果。镜像 Rust MemAnalysis。 */
export interface MemAnalysis {
  total_keys: number;
  total_bytes: number;
  top: KeyMemStat[];
}

/** 服务器实时统计（INFO 解析）。镜像 Rust ServerStats。 */
export interface ServerStats {
  used_memory_bytes: number;
  used_memory_peak_bytes: number;
  connected_clients: number;
  ops_per_sec: number;
  keyspace_hits: number;
  keyspace_misses: number;
  uptime_secs: number;
  total_commands: number;
  db_key_counts: [string, number][];
}

/** 一条慢日志。镜像 Rust SlowEntry。 */
export interface SlowEntry {
  id: number;
  timestamp_secs: number;
  duration_us: number;
  command: string;
  client: string;
}

export interface HashField {
  field: string;
  value: string;
}

export interface ZSetMember {
  member: string;
  score: number;
}

/** 值视图（按 kind 判别）。注意 z_set 的 tag 是 "z_set"（与类型的 "zset" 不同）。 */
export type ValueView =
  | { kind: "string"; value: string; is_json: boolean }
  | { kind: "hash"; fields: HashField[] }
  | { kind: "list"; items: string[] }
  | { kind: "set"; members: string[] }
  | { kind: "z_set"; members: ZSetMember[] }
  | { kind: "stream"; entries: { id: string; fields: HashField[] }[] }
  | { kind: "unknown"; raw: string };

/** List 追加方向（镜像 Rust ListSide，serde 小写）。 */
export type ListSide = "left" | "right";

/** 写操作意图（镜像 Rust WriteOp，按 `op` 判别；serde snake_case）。 */
export type WriteOp =
  | { op: "set_string"; value: string }
  | { op: "hash_set"; field: string; value: string }
  | { op: "hash_del"; field: string }
  | { op: "list_push"; side: ListSide; value: string }
  | { op: "list_set"; index: number; value: string }
  | { op: "list_remove"; count: number; value: string }
  | { op: "set_add"; member: string }
  | { op: "set_remove"; member: string }
  | { op: "zset_add"; member: string; score: number }
  | { op: "zset_remove"; member: string };

/** 推给前端的 Pub/Sub 消息事件（带连接 id，前端按 id 过滤）。 */
export interface PubsubMessage {
  id: string;
  channel: string;
  value: string;
  /** "message" | "pmessage" | "smessage" */
  kind: string;
}

/** 推给前端的 MONITOR 命令事件。 */
export interface MonitorCommand {
  id: string;
  command: string;
  db: number;
  client: string;
  timestamp: number;
}

/** Stream 消费组概要（XINFO GROUPS）。lag 在 Redis<7 上为 null。 */
export interface StreamGroupInfo {
  name: string;
  consumers: number;
  pending: number;
  lag: number | null;
  last_delivered_id: string;
}

/** Stream 消费组待处理条目（XPENDING 详式）。 */
export interface PendingEntry {
  id: string;
  consumer: string;
  /** 自上次投递以来的空闲毫秒。 */
  idle_ms: number;
  /** 投递次数。 */
  deliveries: number;
}
