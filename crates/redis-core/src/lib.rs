//! # redis-core
//!
//! Redis 访问核心层。**不依赖 Tauri**，可独立编译与测试
//! （`cargo test -p redis-core`）。
//!
//! 设计目标见：
//! - `docs/PRD.md`（产品需求 / 架构分层）
//! - `docs/decisions/ADR-001-redis-driver-selection.md`（驱动选型与风险对冲）
//!
//! ## 核心抽象
//!
//! 上层（Tauri 命令层、未来可能的 CLI/SDK）只依赖 [`RedisGateway`] trait，
//! **绝不直接 import fred 类型**。这是 ADR-001 的风险对冲关键：
//! 万一未来需要更换驱动，影响面被锁在 [`fred_gateway::FredGateway`] 一个实现里。
//!
//! ```text
//!  Tauri 命令层  ──▶  RedisGateway (trait)  ◀──  FredGateway (impl)
//!                          │                          │
//!                    领域类型/ AppError            fred 类型
//! ```

pub mod error;
pub mod fred_gateway;
pub mod gateway;
pub mod monitor;
pub mod pubsub;
pub mod types;

pub use error::AppError;
pub use fred_gateway::{FredConnectConfig, FredGateway};
pub use gateway::{RedisGateway, ScanCursor, ScanPage};
pub use monitor::{run_monitor, MonitorCmd};
pub use pubsub::{PubsubMessage, PubsubSubscriber};
pub use types::{
    HashField, KeyBrief, KeyDetail, KeyMemStat, ListSide, MemAnalysis, PagePos, PatternStats,
    PendingEntry, RedisType, ServerInfo, ServerStats, SlowEntry, StreamEntry, StreamGroupInfo,
    ValuePage, ValueView, WriteOp,
};
