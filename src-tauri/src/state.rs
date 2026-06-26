//! 应用状态：连接配置（持久化 + 钥匙串）+ 活跃连接句柄。
//!
//! M1 起：连接配置经 [`crate::connection_store::ConnectionStore`] 落盘（非密码字段），
//! 密码单独存系统钥匙串（keyring）。内存中的 `configs` 不持有密码；`password` 字段
//! 带 `#[serde(skip_serializing)]`，因此绝不会出现在磁盘 JSON 或回传前端的 IPC 响应里。

use std::collections::HashMap;
use std::sync::Arc;

use redis_core::FredGateway;
use serde::{Deserialize, Serialize};
use tauri::async_runtime::Mutex;

use crate::connection_store::ConnectionStore;
use crate::ssh_tunnel::{SshTunnelConfig, TunnelHandle};

/// 连接级「浏览偏好」。全部字段 `#[serde(default)]` + `Option`，
/// 旧 `connections.json`（无 `prefs`）反序列化为全 `None` → 由前端解析器套默认值。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConnPrefs {
    /// SCAN COUNT 提示值（每页 key 数）。`None` => 200；前端解析时 `< 1` 也回退 200。
    #[serde(default)]
    pub scan_count: Option<u32>,
    /// Key 命名空间分隔符（树视图按此切分）。`None` => ":"。空串 => 不分组。
    #[serde(default)]
    pub key_separator: Option<String>,
    /// 默认浏览视图："flat" | "tree"。`None` 或非上述值 => "tree"。
    #[serde(default)]
    pub default_view: Option<String>,
    /// 值面板自动刷新间隔（秒）。`None` => 2；0 => 关闭。
    #[serde(default)]
    pub auto_refresh_secs: Option<u32>,
}

/// 连接配置（经 IPC 与前端共享）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    /// 仅用于「前端 save 输入」与「connect 时从钥匙串临时注入」两个方向；
    /// `skip_serializing` 确保它**永不**出现在落盘 JSON 或 `list_connections` 响应中。
    /// `default` 容忍缺该字段的旧文件 / 旧 IPC 载荷。
    #[serde(default, skip_serializing)]
    pub password: Option<String>,
    pub db: u8,
    pub tls: bool,
    pub group: Option<String>,
    /// 连接级浏览偏好（每页数/分隔符/默认视图/自动刷新间隔）。
    /// `#[serde(default)]` 容忍旧文件无该字段。
    #[serde(default)]
    pub prefs: ConnPrefs,
    /// SSH 隧道（可选，经堡垒机连内网 Redis）。`#[serde(default)]` 容忍旧文件。
    #[serde(default)]
    pub ssh: Option<SshTunnelConfig>,
    /// 最近一次成功连接的 Unix 秒；用于侧栏「最近使用置顶」排序。
    /// `#[serde(default)]` 容忍旧文件（老连接 = `None`，排序时排末尾）。
    #[serde(default)]
    pub last_used_at: Option<i64>,
}

impl ConnectionConfig {
    /// 转为 fred 连接配置（URL scheme，fred 自动识别 standalone/cluster/TLS）。
    pub fn to_fred(&self) -> redis_core::FredConnectConfig {
        let mut url = String::from(if self.tls { "rediss://" } else { "redis://" });
        if let Some(p) = &self.password {
            if !p.is_empty() {
                // 用户名（ACL）@密码
                if let Some(u) = &self.username {
                    url.push_str(&format!("{}:{}@", u, p));
                } else {
                    url.push_str(&format!(":{}@", p));
                }
            }
        }
        url.push_str(&format!("{}:{}/{}", self.host, self.port, self.db));
        redis_core::FredConnectConfig {
            url,
            timeout_secs: 5,
        }
    }
}

/// 默认分组内部 key（后端不 i18n）；前端展示时翻译为「默认 / Default」。
/// `upsert_group` / `rename_group` / `delete_group` 对此 key 一律拒绝。
pub const DEFAULT_GROUP: &str = "__default__";

/// 分组环境标识。`Prod` 触发前端危险操作（删 key / FLUSH / 批量删）的强确认。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GroupEnv {
    #[default]
    Dev,
    Staging,
    Prod,
}

/// 连接分组元数据（独立 `groups.json`）。连接用 [`ConnectionConfig::group`] 的名字弱引用，
/// 故 `name` 为唯一键；重命名需级联改所有引用它的连接。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMeta {
    /// 分组名（唯一键）。
    pub name: String,
    /// 环境标识（Dev/Staging/Prod）。
    #[serde(default)]
    pub environment: GroupEnv,
    /// 排序权重（升序）；默认组固定最小，其余从 1 起。组级「置顶」靠改 order。
    #[serde(default)]
    pub order: i32,
    /// 色条 hex（如 "#ef4444"）；`None` => 无色。
    #[serde(default)]
    pub color: Option<String>,
    /// 可选备注。
    #[serde(default)]
    pub note: Option<String>,
    /// 创建时间（Unix 秒），用于 `order` 相同时的稳定次级排序。
    #[serde(default)]
    pub created_at: i64,
}

/// 应用全局状态。
pub struct AppState {
    /// 活跃连接：id → 网关句柄
    pub connections: Mutex<HashMap<String, Arc<FredGateway>>>,
    /// 已保存的连接配置（内存为权威来源，磁盘为快照）；其中 **不含密码**
    pub configs: Mutex<Vec<ConnectionConfig>>,
    /// 分组元数据（内存为权威来源，磁盘为快照）。
    pub groups: Mutex<Vec<GroupMeta>>,
    /// 连接配置持久化器（落盘）+ 密码钥匙串
    pub store: ConnectionStore,
    /// 活跃 SSH 隧道：id → 隧道句柄（断开时关闭，防本地端口泄漏）。
    pub tunnels: Mutex<HashMap<String, TunnelHandle>>,
    /// 活跃 Pub/Sub 订阅器：id → 句柄（独立连接；断开连接时关闭）。
    pub subscribers: Mutex<HashMap<String, PubsubHandle>>,
    /// 活跃 MONITOR 任务：id → 句柄（独立连接；断开连接时停止）。
    pub monitors: Mutex<HashMap<String, MonitorHandle>>,
    /// 活跃健康探测任务：id → 句柄（周期 ping → Tauri 事件；断开连接时停止）。
    pub health: Mutex<HashMap<String, HealthHandle>>,
}

/// Pub/Sub 订阅句柄：专用连接 + 当前订阅的频道/模式 + 转发→Tauri 事件的任务。
pub struct PubsubHandle {
    pub sub: redis_core::PubsubSubscriber,
    pub subs: Vec<String>,
    pub patterns: Vec<String>,
    pub drain: tauri::async_runtime::JoinHandle<()>,
}

/// MONITOR 句柄：跑 MONITOR 的任务 + 转发→Tauri 事件的任务。
pub struct MonitorHandle {
    pub run: tauri::async_runtime::JoinHandle<()>,
    pub drain: tauri::async_runtime::JoinHandle<()>,
}

/// 健康探测句柄：周期 ping 检测连通性并向前端推 conn-health 事件的任务。
pub struct HealthHandle {
    pub task: tauri::async_runtime::JoinHandle<()>,
}

impl AppState {
    /// 构造状态。生产启动经 `main.rs` 的 `.setup()` 注入 store 与启动时加载的配置。
    pub fn new(
        store: ConnectionStore,
        configs: Vec<ConnectionConfig>,
        groups: Vec<GroupMeta>,
    ) -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
            configs: Mutex::new(configs),
            groups: Mutex::new(groups),
            store,
            tunnels: Mutex::new(HashMap::new()),
            subscribers: Mutex::new(HashMap::new()),
            monitors: Mutex::new(HashMap::new()),
            health: Mutex::new(HashMap::new()),
        }
    }
}
