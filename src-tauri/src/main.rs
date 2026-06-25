// Tauri 桌面应用入口（M0 采用单 main.rs 结构；移动端支持时再拆 lib.rs）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod connection_store;
mod health;
mod pubsub;
mod ssh_tunnel;
mod state;

use redis_core::{
    AppError, FredGateway, PendingEntry, RedisGateway, RedisType, ScanCursor, ServerInfo,
    StreamGroupInfo, WriteOp,
};
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::connection_store::ConnectionStore;
use crate::ssh_tunnel::{open as open_tunnel, SshAuth, SshTunnelConfig};
use crate::state::{AppState, ConnectionConfig};

// ========== IPC 健康检查 ==========

#[derive(Serialize)]
struct PingResponse {
    message: String,
    version: String,
    /// 确认 redis-core 已正确链接进应用
    core_linked: bool,
}

/// M0 退出标准：UI 触发 Rust 并回显。
#[tauri::command]
fn ping() -> PingResponse {
    PingResponse {
        message: "pong".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        core_linked: true,
    }
}

// ========== SSH 隧道辅助（凭据经加密 store 的前缀键 ssh:pass:: / ssh:keypass::）==========

/// 提取并清空 SSH 配置里的敏感字段（password / passphrase），返回 (kind, secret) 供加密存储。
fn strip_ssh_secret(ssh: &mut SshTunnelConfig) -> Option<(&'static str, String)> {
    match &mut ssh.auth {
        SshAuth::Password { password } => {
            let p = std::mem::take(password);
            if p.is_empty() {
                None
            } else {
                Some(("pass", p))
            }
        }
        SshAuth::PrivateKey { passphrase, .. } => passphrase.take().map(|p| ("keypass", p)),
    }
}

/// 回填缺失的 SSH 敏感字段（编辑已存连接测试/连接时；store 调用须在 spawn_blocking）。
fn reassemble_ssh(
    store: &ConnectionStore,
    id: &str,
    mut ssh: SshTunnelConfig,
) -> Result<SshTunnelConfig, AppError> {
    match &mut ssh.auth {
        SshAuth::Password { password } => {
            if password.is_empty() {
                *password = store
                    .get_password(&format!("ssh:pass::{id}"))?
                    .unwrap_or_default();
            }
        }
        SshAuth::PrivateKey { passphrase, .. } => {
            if passphrase.is_none() {
                *passphrase = store.get_password(&format!("ssh:keypass::{id}"))?;
            }
        }
    }
    Ok(ssh)
}

/// 经隧道时构造指向本地端口的 fred URL（无 TLS；用户名/密码/库沿用原配置）。
pub(crate) fn tunnel_fred_url(
    username: &Option<String>,
    password: &Option<String>,
    local_port: u16,
    db: u8,
) -> String {
    let mut url = String::from("redis://");
    if let Some(p) = password {
        if !p.is_empty() {
            match username {
                Some(u) if !u.is_empty() => url.push_str(&format!("{}:{}@", u, p)),
                _ => url.push_str(&format!(":{}@", p)),
            }
        }
    }
    url.push_str(&format!("127.0.0.1:{}/{}", local_port, db));
    url
}

// ========== 连接配置管理（持久化 + 钥匙串）==========

#[tauri::command]
async fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionConfig>, AppError> {
    // password 字段 skip_serializing，响应里天然不含密码
    Ok(state.configs.lock().await.clone())
}

#[tauri::command]
async fn save_connection(
    mut config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    // 新建连接：id 为空则生成
    if config.id.is_empty() {
        config.id = Uuid::new_v4().to_string();
    }
    let id = config.id.clone();

    // 「密码留空 = 保留现有钥匙串条目」：仅收到非空密码才覆盖
    let new_password =
        config
            .password
            .as_ref()
            .and_then(|p| if p.is_empty() { None } else { Some(p.clone()) });

    // SSH 敏感字段（密码 / 私钥 passphrase）：提取后从 config 清空（随配置落盘的是无敏感版）。
    let ssh_secret = config.ssh.as_mut().and_then(strip_ssh_secret);

    // 锁内：内存增改（不保存密码/SSH 敏感）+ 快照；锁外：落盘 + 钥匙串（阻塞 IO）
    let snapshot: Vec<ConnectionConfig> = {
        let mut incoming = config.clone();
        incoming.password = None; // 内存里绝不留密码
        let mut cfgs = state.configs.lock().await;
        if let Some(c) = cfgs.iter_mut().find(|c| c.id == incoming.id) {
            *c = incoming;
        } else {
            cfgs.push(incoming);
        }
        cfgs.clone()
    };

    let store = state.store.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        store.save_all(&snapshot)?;
        if let Some(pw) = new_password {
            store.set_password(&id, &pw)?;
        }
        // SSH 敏感凭据落加密 store（前缀键）；非空才覆盖，空=保留现有。
        if let Some((kind, secret)) = ssh_secret {
            store.set_password(&format!("ssh:{kind}::{id}"), &secret)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(format!("持久化任务失败: {e}")))??;

    Ok(config.id)
}

#[tauri::command]
async fn delete_connection(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    // 锁内：移除配置 + 快照
    let snapshot: Vec<ConnectionConfig> = {
        let mut cfgs = state.configs.lock().await;
        cfgs.retain(|c| c.id != id);
        cfgs.clone()
    };

    // 锁外：落盘 + 删钥匙串。落盘失败向上传播；钥匙串删除失败仅记日志（孤立条目无害可重建）
    let id_for_keyring = id.clone();
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        store.save_all(&snapshot)?;
        if let Err(e) = store.delete_password(&id_for_keyring) {
            eprintln!("[delete_connection] 钥匙串删除失败（已忽略）: {e}");
        }
        // 连带删 SSH 敏感凭据（前缀键）。
        for kind in ["pass", "keypass"] {
            let _ = store.delete_password(&format!("ssh:{kind}::{id_for_keyring}"));
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Other(format!("持久化任务失败: {e}")))??;

    // 断开活跃连接 + 关闭隧道
    state.connections.lock().await.remove(&id);
    if let Some(t) = state.tunnels.lock().await.remove(&id) {
        t.close().await;
    }
    // 关闭该连接的 Pub/Sub 订阅器与 MONITOR（若有）
    pubsub::cleanup(&state, &id).await;
    // 停止该连接的健康探测任务（若有）
    health::cleanup(&state, &id).await;
    Ok(())
}

// ========== 连接生命周期 ==========

#[tauri::command]
async fn test_connection(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<ServerInfo, AppError> {
    let mut cfg = config;
    // 编辑已存连接时密码框为空（list 不回传密码）→ 回退取存储密码再测；新建连接用表单密码
    let need_stored = !cfg.id.is_empty() && cfg.password.as_deref().is_none_or(|p| p.is_empty());
    if need_stored {
        let id_for_pw = cfg.id.clone();
        let store = state.store.clone();
        let stored = tokio::task::spawn_blocking(move || store.get_password(&id_for_pw))
            .await
            .map_err(|e| AppError::Other(format!("密码任务失败: {e}")))?;
        if let Ok(Some(pw)) = stored {
            cfg.password = Some(pw);
        }
    }

    // SSH 隧道（若配置）：编辑已存连接且敏感字段空 → 回填存储；新建用表单值。
    let tunnel = if let Some(ssh) = cfg.ssh.clone() {
        if cfg.tls {
            return Err(AppError::Other(
                "SSH 隧道与 TLS 不能同时启用（经隧道的 Redis 不应再 TLS）".into(),
            ));
        }
        let ssh = if !cfg.id.is_empty() {
            let store = state.store.clone();
            let id2 = cfg.id.clone();
            tokio::task::spawn_blocking(move || reassemble_ssh(&store, &id2, ssh))
                .await
                .map_err(|e| AppError::Other(format!("SSH 凭据任务失败: {e}")))?
                .map_err(|e| AppError::Other(format!("SSH 凭据读取失败: {e}")))?
        } else {
            ssh
        };
        Some(open_tunnel(&ssh, &cfg.host, cfg.port).await?)
    } else {
        None
    };

    let fred_cfg = match &tunnel {
        Some(t) => redis_core::FredConnectConfig {
            url: tunnel_fred_url(&cfg.username, &cfg.password, t.local_port, cfg.db),
            timeout_secs: 5,
        },
        None => cfg.to_fred(),
    };
    let gw = FredGateway::connect(fred_cfg).await?;
    let info = gw.ping().await;
    drop(gw);
    if let Some(t) = tunnel {
        let _ = t.close().await;
    }
    info
}

#[tauri::command]
async fn connect(
    id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ServerInfo, AppError> {
    // 锁内：取配置快照（不含密码）；锁外：从钥匙串取密码注入局部 clone
    let mut cfg = {
        let cfgs = state.configs.lock().await;
        cfgs.iter().find(|c| c.id == id).cloned()
    }
    .ok_or_else(|| AppError::Config(format!("找不到连接配置 {id}")))?;

    // 钥匙串取密码（阻塞）→ 仅注入局部变量，不回填内存状态
    let store = state.store.clone();
    let id_for_keyring = id.clone();
    let password = tokio::task::spawn_blocking(move || store.get_password(&id_for_keyring))
        .await
        .map_err(|e| AppError::Other(format!("钥匙串任务失败: {e}")))??;
    cfg.password = password;

    // SSH 隧道（若配置）：开本地端口转发，fred 连 127.0.0.1:本地端口。
    let tunnel = if let Some(ssh) = cfg.ssh.clone() {
        if cfg.tls {
            return Err(AppError::Other(
                "SSH 隧道与 TLS 不能同时启用（经隧道的 Redis 不应再 TLS）".into(),
            ));
        }
        let store = state.store.clone();
        let id2 = id.clone();
        let ssh = tokio::task::spawn_blocking(move || reassemble_ssh(&store, &id2, ssh))
            .await
            .map_err(|e| AppError::Other(format!("SSH 凭据任务失败: {e}")))?
            .map_err(|e| AppError::Other(format!("SSH 凭据读取失败: {e}")))?;
        Some(open_tunnel(&ssh, &cfg.host, cfg.port).await?)
    } else {
        None
    };

    let fred_cfg = match &tunnel {
        Some(t) => redis_core::FredConnectConfig {
            url: tunnel_fred_url(&cfg.username, &cfg.password, t.local_port, cfg.db),
            timeout_secs: 5,
        },
        None => cfg.to_fred(),
    };
    // 连接失败要关闭已开的隧道，防本地端口泄漏。
    let gw = match FredGateway::connect(fred_cfg).await {
        Ok(g) => g,
        Err(e) => {
            if let Some(t) = tunnel {
                let _ = t.close().await;
            }
            return Err(e);
        }
    };
    let info = gw.ping().await?;
    let gw = Arc::new(gw);
    // 启动健康探测任务（周期 ping → conn-health 事件）。
    let hh = health::spawn(id.clone(), gw.clone(), app);
    state.health.lock().await.insert(id.clone(), hh);
    state.connections.lock().await.insert(id.clone(), gw);
    if let Some(t) = tunnel {
        state.tunnels.lock().await.insert(id, t);
    }
    Ok(info)
}

#[tauri::command]
async fn disconnect(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    // 先停健康探测，再断数据连接（避免拆除期间 dbsize 报错触发误报事件）
    health::cleanup(&state, &id).await;
    // FredGateway drop 时 fred 自动关闭底层连接
    state.connections.lock().await.remove(&id);
    // 关闭 SSH 隧道（若有），释放本地端口
    if let Some(t) = state.tunnels.lock().await.remove(&id) {
        t.close().await;
    }
    // 关闭该连接的 Pub/Sub 订阅器与 MONITOR（独立连接，须显式清理）
    pubsub::cleanup(&state, &id).await;
    Ok(())
}

/// 取活跃网关句柄（共享引用，避免长时间持锁）。
async fn get_gateway(state: &State<'_, AppState>, id: &str) -> Result<Arc<FredGateway>, AppError> {
    state
        .connections
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or(AppError::NotConnected)
}

// ========== 数据访问（经 RedisGateway trait，不碰 fred）==========

#[tauri::command]
async fn dbsize(id: String, state: State<'_, AppState>) -> Result<u64, AppError> {
    get_gateway(&state, &id).await?.dbsize().await
}

#[tauri::command]
async fn select_db(id: String, db: u8, state: State<'_, AppState>) -> Result<(), AppError> {
    get_gateway(&state, &id).await?.select_db(db).await
}

#[tauri::command]
async fn scan_keys(
    id: String,
    cursor: u64,
    pattern: Option<String>,
    count: Option<u64>,
    ty: Option<RedisType>,
    state: State<'_, AppState>,
) -> Result<redis_core::ScanPage, AppError> {
    let gw = get_gateway(&state, &id).await?;
    gw.scan(
        ScanCursor(cursor),
        pattern.as_deref(),
        ty,
        count.unwrap_or(200),
    )
    .await
}

#[tauri::command]
async fn get_key_detail(
    id: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<redis_core::KeyDetail, AppError> {
    let gw = get_gateway(&state, &id).await?;
    let detail = gw.key_detail(&key).await?;
    // key 不存在 → 报错（消息含 "no such key"），让前端 not-exist 判定关闭对应标签。
    if detail.ty == RedisType::None {
        return Err(AppError::Other("no such key".into()));
    }
    Ok(detail)
}

/// 读取集合的一页（list/zset=offset，hash/set=cursor，stream=after_id）。
#[tauri::command]
async fn read_value_page(
    id: String,
    key: String,
    ty: RedisType,
    pos: redis_core::PagePos,
    limit: u64,
    state: State<'_, AppState>,
) -> Result<redis_core::ValuePage, AppError> {
    get_gateway(&state, &id)
        .await?
        .read_value_page(&key, ty, pos, limit)
        .await
}

#[tauri::command]
async fn exec_command(
    id: String,
    args: Vec<String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    get_gateway(&state, &id).await?.exec_raw(&args).await
}

#[tauri::command]
async fn write_key(
    id: String,
    key: String,
    op: WriteOp,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    get_gateway(&state, &id).await?.write(&key, op).await
}

#[tauri::command]
async fn set_ttl(
    id: String,
    key: String,
    ttl: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    get_gateway(&state, &id).await?.set_ttl(&key, ttl).await
}

#[tauri::command]
async fn delete_key(id: String, key: String, state: State<'_, AppState>) -> Result<bool, AppError> {
    get_gateway(&state, &id).await?.del(&key).await
}

/// 单 key 占用字节数（MEMORY USAGE）。
#[tauri::command]
async fn key_memory_usage(
    id: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<u64>, AppError> {
    get_gateway(&state, &id).await?.memory_usage(&key).await
}

/// 命名空间（pattern）统计：key 数 + 总字节。
#[tauri::command]
async fn pattern_stats(
    id: String,
    pattern: String,
    state: State<'_, AppState>,
) -> Result<redis_core::PatternStats, AppError> {
    get_gateway(&state, &id)
        .await?
        .pattern_stats(&pattern)
        .await
}

/// 删除匹配 pattern 的全部 key（UNLINK），返回删除数。危险：由前端确认后调用。
#[tauri::command]
async fn delete_by_pattern(
    id: String,
    pattern: String,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    get_gateway(&state, &id)
        .await?
        .delete_by_pattern(&pattern)
        .await
}

/// 重命名 key（RENAME）。
#[tauri::command]
async fn rename_key(
    id: String,
    src: String,
    dst: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    get_gateway(&state, &id).await?.rename_key(&src, &dst).await
}

/// 复制 key（COPY，Redis 6.2+）；replace=true 覆盖已存在的目标。
#[tauri::command]
async fn copy_key(
    id: String,
    src: String,
    dst: String,
    replace: bool,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    get_gateway(&state, &id)
        .await?
        .copy_key(&src, &dst, replace)
        .await
}

/// 对匹配 pattern 的全部 key 批量设 TTL（Some=EXPIRE，None=PERSIST），返回处理数。危险：由前端确认后调用。
#[tauri::command]
async fn set_ttl_by_pattern(
    id: String,
    pattern: String,
    ttl: Option<i64>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    get_gateway(&state, &id)
        .await?
        .set_ttl_by_pattern(&pattern, ttl)
        .await
}

/// Stream 消费组列表（XINFO GROUPS）。
#[tauri::command]
async fn stream_groups(
    id: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<Vec<StreamGroupInfo>, AppError> {
    get_gateway(&state, &id).await?.stream_groups(&key).await
}

/// 新建消费组（XGROUP CREATE）。id 通常 "$"（仅新消息）或 "0"（全部历史）。
#[tauri::command]
async fn create_group(
    id: String,
    key: String,
    group: String,
    start_id: String,
    mkstream: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    get_gateway(&state, &id)
        .await?
        .stream_create_group(&key, &group, &start_id, mkstream)
        .await
}

/// 删除消费组（XGROUP DESTROY）。破坏性，由前端二次确认后调用。
#[tauri::command]
async fn destroy_group(
    id: String,
    key: String,
    group: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    get_gateway(&state, &id)
        .await?
        .stream_destroy_group(&key, &group)
        .await
}

/// 确认消息（XACK），返回确认条数。
#[tauri::command]
async fn stream_ack(
    id: String,
    key: String,
    group: String,
    entry_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    get_gateway(&state, &id)
        .await?
        .stream_ack(&key, &group, &entry_ids)
        .await
}

/// 消费组待处理条目（XPENDING 详式，前 count 条）。
#[tauri::command]
async fn stream_pending(
    id: String,
    key: String,
    group: String,
    count: u64,
    state: State<'_, AppState>,
) -> Result<Vec<PendingEntry>, AppError> {
    get_gateway(&state, &id)
        .await?
        .stream_pending(&key, &group, count)
        .await
}

/// 整库内存分析：key 总数 + 总字节 + 占用 top-N 的 key（扫当前 db）。
#[tauri::command]
async fn analyze_memory(
    id: String,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<redis_core::MemAnalysis, AppError> {
    get_gateway(&state, &id).await?.analyze_memory(limit).await
}

/// 服务器实时统计（INFO 解析）。
#[tauri::command]
async fn server_stats(
    id: String,
    state: State<'_, AppState>,
) -> Result<redis_core::ServerStats, AppError> {
    get_gateway(&state, &id).await?.server_stats().await
}

/// 慢日志（SLOWLOG GET）。
#[tauri::command]
async fn slowlog(
    id: String,
    limit: i64,
    state: State<'_, AppState>,
) -> Result<Vec<redis_core::SlowEntry>, AppError> {
    get_gateway(&state, &id).await?.slowlog(limit).await
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // app 配置目录（macOS: ~/Library/Application Support/com.redis-client.app）
            let dir = app
                .path()
                .app_config_dir()
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            let store = ConnectionStore::new(dir)?;
            // 读取失败容错为空列表，不阻断启动
            let configs = store.load_all().unwrap_or_else(|e| {
                eprintln!("[startup] 加载连接配置失败，以空列表启动: {e}");
                Vec::new()
            });
            app.manage(AppState::new(store, configs));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            list_connections,
            save_connection,
            delete_connection,
            test_connection,
            connect,
            disconnect,
            dbsize,
            select_db,
            scan_keys,
            get_key_detail,
            read_value_page,
            exec_command,
            write_key,
            set_ttl,
            delete_key,
            key_memory_usage,
            pattern_stats,
            delete_by_pattern,
            rename_key,
            copy_key,
            set_ttl_by_pattern,
            analyze_memory,
            server_stats,
            slowlog,
            pubsub::pubsub_subscribe,
            pubsub::pubsub_unsubscribe,
            pubsub::pubsub_publish,
            pubsub::monitor_start,
            pubsub::monitor_stop,
            stream_groups,
            create_group,
            destroy_group,
            stream_ack,
            stream_pending,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
