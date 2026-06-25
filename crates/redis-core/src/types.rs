//! 领域类型。与驱动无关，前后端共享（经 serde 序列化经 IPC 传输）。

use serde::{Deserialize, Serialize};

/// Redis 数据类型。
///
/// 序列化为小写（与 Redis `TYPE` 命令返回一致），前端可直接匹配。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RedisType {
    String,
    Hash,
    List,
    Set,
    ZSet,
    Stream,
    /// key 不存在（`TYPE` 返回 `none`）
    None,
    /// 未知/扩展类型（如 Redis Stack 的 ReJSON-RL 等）
    Unknown,
}

impl RedisType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Hash => "hash",
            Self::List => "list",
            Self::Set => "set",
            Self::ZSet => "zset",
            Self::Stream => "stream",
            Self::None => "none",
            Self::Unknown => "unknown",
        }
    }
}

impl From<&str> for RedisType {
    fn from(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "string" => Self::String,
            "hash" => Self::Hash,
            "list" => Self::List,
            "set" => Self::Set,
            "zset" => Self::ZSet,
            "stream" => Self::Stream,
            "none" => Self::None,
            _ => Self::Unknown,
        }
    }
}

/// 服务器简要信息（`ping` / `INFO` 解析结果）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub reachable: bool,
    pub version: Option<String>,
    /// standalone | cluster | sentinel（解析 `INFO replication` 等）
    pub mode: Option<String>,
}

/// Key 列表中的一行（SCAN + TYPE + TTL 汇总）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyBrief {
    pub key: String,
    #[serde(rename = "type")]
    pub ty: RedisType,
    /// TTL（秒）；`None` = 持久（无过期，或扫描期间 key 已消失）。
    pub ttl: Option<i64>,
}

/// 单 key 的完整详情：类型 + TTL + 值（一次取值，供值面板/标签刷新，
/// 刷新时三者一起更新——TTL 不再卡在列表快照）。`ty == None` 表示 key 已不存在。
///
/// 集合类型的 `value` 是**首页**（分页取，避免大集合全量拉取）；`total` 为成员总数，
/// `next_pos` 为首页之后的下一分页位置（None=无更多页）。string/unknown 无分页。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyDetail {
    pub key: String,
    #[serde(rename = "type")]
    pub ty: RedisType,
    /// TTL（秒）；`None` = 持久。
    pub ttl: Option<i64>,
    /// 集合成员总数；string/unknown 为 None。
    #[serde(default)]
    pub total: Option<u64>,
    /// 首页之后的下一分页位置；None=无更多页或非分页类型。
    #[serde(default)]
    pub next_pos: Option<PagePos>,
    pub value: ValueView,
}

/// 分页位置（按类型分页语义不同）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "by", rename_all = "snake_case")]
pub enum PagePos {
    /// list / zset：按索引偏移（可跳页）。
    Offset { offset: u64 },
    /// hash / set：HSCAN/SSCAN 游标（前/后翻）。
    Cursor { cursor: u64 },
    /// stream：从某 id 之后（"-" 表示从头；下一页用 `(lastid`）。
    AfterId { id: String },
}

/// 一页集合值 + 下一页位置（None=到底）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValuePage {
    pub value: ValueView,
    pub next: Option<PagePos>,
}

/// 一个 pattern（命名空间）的统计：匹配的 key 数 + 总占用字节数（MEMORY USAGE 求和）。
/// 供右键「查看目录存储大小」用。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PatternStats {
    pub count: u64,
    pub bytes: u64,
}

/// 单 key 的内存占用统计（供「最大 key」分析）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyMemStat {
    pub key: String,
    #[serde(rename = "type")]
    pub ty: RedisType,
    /// TTL（秒）；None = 持久。
    pub ttl: Option<i64>,
    pub bytes: u64,
}

/// 整库内存分析结果：扫描到的 key 总数 + 总字节 + 占用 top-N 的 key。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemAnalysis {
    pub total_keys: u64,
    pub total_bytes: u64,
    pub top: Vec<KeyMemStat>,
}

/// 服务器实时统计（解析 INFO）。供「监控」面板。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ServerStats {
    pub used_memory_bytes: u64,
    pub used_memory_peak_bytes: u64,
    pub connected_clients: u64,
    pub ops_per_sec: u64,
    pub keyspace_hits: u64,
    pub keyspace_misses: u64,
    pub uptime_secs: u64,
    pub total_commands: u64,
    /// 各 db 的 key 数：("db0", 1234)。
    pub db_key_counts: Vec<(String, u64)>,
}

/// 一条慢日志（SLOWLOG GET）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlowEntry {
    pub id: i64,
    pub timestamp_secs: i64,
    pub duration_us: i64,
    pub command: String,
    pub client: String,
}

/// Hash 的一个字段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashField {
    pub field: String,
    pub value: String,
}

/// ZSet 成员
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZSetMember {
    pub member: String,
    pub score: f64,
}

/// Stream entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEntry {
    pub id: String,
    pub fields: Vec<HashField>,
}

/// 消费组概要（XINFO GROUPS）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamGroupInfo {
    pub name: String,
    pub consumers: u64,
    pub pending: u64,
    /// 待处理条目积压（lag，Redis 7+；旧版为 None）。
    pub lag: Option<i64>,
    /// 该组最后投递的 entry id。
    pub last_delivered_id: String,
}

/// 待处理条目（XPENDING 详式）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingEntry {
    pub id: String,
    pub consumer: String,
    /// 空闲毫秒（自上次投递以来）。
    pub idle_ms: u64,
    /// 投递次数。
    pub deliveries: u64,
}

/// 值的视图，按类型分形态。前端据此选择渲染方式（表格/JSON/列表）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ValueView {
    String {
        value: String,
        is_json: bool,
    },
    Hash {
        fields: Vec<HashField>,
    },
    List {
        items: Vec<String>,
    },
    Set {
        members: Vec<String>,
    },
    #[serde(rename = "z_set")]
    ZSet {
        members: Vec<ZSetMember>,
    },
    Stream {
        entries: Vec<StreamEntry>,
    },
    Unknown {
        raw: String,
    },
}

/// 写操作意图（跨 IPC，按 `op` 标签判别）。前端 TS 侧为同名判别联合。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum WriteOp {
    /// 覆盖 String 值（SET）。TTL 与值正交，走 [`crate::gateway::RedisGateway::set_ttl`]。
    SetString { value: String },
    /// 新增/更新 Hash 字段（HSET）。
    HashSet { field: String, value: String },
    /// 删除 Hash 字段（HDEL）。
    HashDel { field: String },
    /// List 头/尾追加（LPUSH/RPUSH）。
    ListPush { side: ListSide, value: String },
    /// 按索引更新 List 元素（LSET）。
    ListSet { index: i64, value: String },
    /// 从 List 移除元素（LREM）。
    ListRemove { count: i64, value: String },
    /// 集合添加成员（SADD）。
    SetAdd { member: String },
    /// 集合移除成员（SREM）。
    SetRemove { member: String },
    /// 有序集合新增/更新成员（ZADD）。
    ZSetAdd { member: String, score: f64 },
    /// 有序集合移除成员（ZREM）。
    ZSetRemove { member: String },
}

/// List 追加方向。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ListSide {
    Left,
    Right,
}
