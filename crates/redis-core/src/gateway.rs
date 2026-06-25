//! Redis 访问网关抽象（ADR-001 风险对冲的核心）。
//!
//! 上层（Tauri 命令层、CLI）只依赖 [`RedisGateway`] trait，
//! **绝不 import 任何驱动（fred）类型**。当前唯一实现是
//! [`crate::fred_gateway::FredGateway`]；未来若需更换驱动，只需新增一个实现。

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::types::{
    KeyBrief, KeyDetail, MemAnalysis, PagePos, PatternStats, PendingEntry, RedisType, ServerInfo,
    ServerStats, SlowEntry, StreamGroupInfo, ValuePage, ValueView, WriteOp,
};

/// SCAN 游标；`0` 同时表示起始与「已遍历完毕」。
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ScanCursor(pub u64);

impl ScanCursor {
    pub const START: Self = Self(0);

    pub fn is_done(&self) -> bool {
        self.0 == 0
    }
}

/// SCAN 一页结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanPage {
    pub next_cursor: ScanCursor,
    pub keys: Vec<KeyBrief>,
}

/// Redis 访问网关。
///
/// 所有方法均为 `async`；实现需 `Send + Sync` 以便跨 Tauri 命令复用。
#[async_trait]
pub trait RedisGateway: Send + Sync {
    /// 连通性 + 服务器简要信息（PING / INFO）
    async fn ping(&self) -> Result<ServerInfo, AppError>;

    /// 当前 db 的 key 数量（DBSIZE）
    async fn dbsize(&self) -> Result<u64, AppError>;

    /// 切换逻辑 DB（`SELECT`）。集群模式不支持（仅 db 0）→ 返回 [`AppError::Unsupported`]。
    async fn select_db(&self, db: u8) -> Result<(), AppError>;

    /// 增量扫描 key（SCAN，**绝不使用 KEYS**）。
    ///
    /// - `cursor`：从 [`ScanCursor::START`] 开始，`next_cursor.is_done()` 表示遍历结束。
    /// - `pattern`：可选 glob，如 `user:*`。
    /// - `type_filter`：可选服务端类型过滤（Redis 6+ `SCAN TYPE`）；
    ///   `None` 及 `RedisType::None`/`Unknown` 均视作不过滤。
    /// - `count`：建议每次扫描数量（提示值，非精确）。
    async fn scan(
        &self,
        cursor: ScanCursor,
        pattern: Option<&str>,
        type_filter: Option<RedisType>,
        count: u64,
    ) -> Result<ScanPage, AppError>;

    /// key 的类型；`Ok(None)` 表示 key 不存在。
    async fn key_type(&self, key: &str) -> Result<Option<RedisType>, AppError>;

    /// 读取 key 的值视图（按类型分形态）。
    async fn read_value(&self, key: &str, ty: RedisType) -> Result<ValueView, AppError>;

    /// 集合成员总数（LLEN/HLEN/SCARD/ZCARD/XLEN）；非集合返回 0。
    async fn collection_count(&self, key: &str, ty: RedisType) -> Result<u64, AppError>;

    /// 按分页位置读取集合的一页（list/zset=Offset，hash/set=Cursor，stream=AfterId）。
    async fn read_value_page(
        &self,
        key: &str,
        ty: RedisType,
        pos: PagePos,
        limit: u64,
    ) -> Result<ValuePage, AppError>;

    /// 单 key 完整详情：类型 + TTL + 值（一条 pipeline 取 TYPE+PTTL，再 read_value）。
    /// 供值面板/标签刷新——刷新时三者一起更新（TTL 不再卡在列表快照）。
    /// `ty == None`（key 不存在）时返回占位值（`Unknown`），由调用方决定如何处理。
    async fn key_detail(&self, key: &str) -> Result<KeyDetail, AppError>;

    /// 执行任意原始命令（CLI 用），返回 RESP 文本化结果。
    async fn exec_raw(&self, args: &[String]) -> Result<String, AppError>;

    /// 删除 key，返回是否成功。
    async fn del(&self, key: &str) -> Result<bool, AppError>;

    /// 对 key 执行结构化写操作（增删改，按 [`WriteOp`] 派发）。
    async fn write(&self, key: &str, op: WriteOp) -> Result<(), AppError>;

    /// 设置/清除 TTL：`Some(秒)` = EXPIRE，`None` = PERSIST。
    async fn set_ttl(&self, key: &str, ttl: Option<i64>) -> Result<(), AppError>;

    /// 单 key 占用字节数（MEMORY USAGE）；`Ok(None)` = key 不存在或命令不可用。
    async fn memory_usage(&self, key: &str) -> Result<Option<u64>, AppError>;

    /// 统计一个 pattern（命名空间）的 key 数与总占用字节（扫描全匹配 key 求 MEMORY USAGE 之和）。
    async fn pattern_stats(&self, pattern: &str) -> Result<PatternStats, AppError>;

    /// 删除匹配 pattern 的全部 key（UNLINK，非阻塞）；返回删除数。危险操作，由调用方确认。
    async fn delete_by_pattern(&self, pattern: &str) -> Result<u64, AppError>;

    /// 重命名 key（RENAME）。目标已存在会被覆盖（与 Redis 语义一致）。
    async fn rename_key(&self, src: &str, dst: &str) -> Result<(), AppError>;

    /// 复制 key（COPY，Redis 6.2+）；`replace=true` 覆盖已存在的目标。返回是否成功。
    async fn copy_key(&self, src: &str, dst: &str, replace: bool) -> Result<bool, AppError>;

    /// 对匹配 pattern 的全部 key 批量设 TTL：`Some(秒)`=EXPIRE，`None`=PERSIST（取消过期）。返回处理数。危险操作，由调用方确认。
    async fn set_ttl_by_pattern(&self, pattern: &str, ttl: Option<i64>) -> Result<u64, AppError>;

    /// 整库内存分析（扫当前 db）：返回 key 总数、总字节、占用 top-N 的 key。
    /// `limit` 为返回的 top 行数（内部扫描全库，top-N 用有界缓冲防 OOM）。
    async fn analyze_memory(&self, limit: usize) -> Result<MemAnalysis, AppError>;

    /// 服务器实时统计（解析 INFO：内存/连接/ops/命中率/各 db key 数）。
    async fn server_stats(&self) -> Result<ServerStats, AppError>;

    /// 慢日志（SLOWLOG GET limit）。
    async fn slowlog(&self, limit: i64) -> Result<Vec<SlowEntry>, AppError>;

    /// 发布消息到频道（PUBLISH），返回收到该消息的订阅客户端数。
    /// 经普通连接发送（订阅态连接不能 PUBLISH）。
    async fn publish(&self, channel: &str, message: &str) -> Result<i64, AppError>;

    /// Stream 消费组列表（XINFO GROUPS）。lag 在 Redis<7 上为 None。
    async fn stream_groups(&self, key: &str) -> Result<Vec<StreamGroupInfo>, AppError>;

    /// 新建消费组（XGROUP CREATE）。`id` 为 "$"（仅新）/ "0"（全部历史）或具体 id；
    /// `mkstream=true` 时 key 不存在自动创建。
    async fn stream_create_group(
        &self,
        key: &str,
        group: &str,
        id: &str,
        mkstream: bool,
    ) -> Result<(), AppError>;

    /// 删除消费组（XGROUP DESTROY）。
    async fn stream_destroy_group(&self, key: &str, group: &str) -> Result<(), AppError>;

    /// 确认消息已处理（XACK），返回确认条数。
    async fn stream_ack(&self, key: &str, group: &str, ids: &[String]) -> Result<u64, AppError>;

    /// 消费组待处理条目（XPENDING 详式，前 `count` 条）。
    async fn stream_pending(
        &self,
        key: &str,
        group: &str,
        count: u64,
    ) -> Result<Vec<PendingEntry>, AppError>;
}
