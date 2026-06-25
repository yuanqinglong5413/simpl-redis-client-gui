//! Pub/Sub + MONITOR 命令层。
//!
//! Pub/Sub：每条活跃连接一个**独立** SubscriberClient（Redis 协议下订阅态连接只能跑
//! subscribe/unsubscribe）。消息经 mpsc → Tauri 事件 `pubsub-message` 推送前端。
//! PUBLISH 经普通数据连接（订阅态连接不能 PUBLISH）→ 走 RedisGateway::publish。
//!
//! MONITOR：独立连接跑 MONITOR，命令流 → Tauri 事件 `monitor-command`。仅 centralized。
use redis_core::{
    run_monitor, AppError, FredConnectConfig, MonitorCmd, PubsubSubscriber, RedisGateway,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::{AppState, MonitorHandle, PubsubHandle};
use crate::tunnel_fred_url;

/// 推给前端的 Pub/Sub 消息事件（带连接 id，前端按 id 过滤）。
#[derive(Clone, Serialize)]
struct PubsubEvent {
    id: String,
    channel: String,
    value: String,
    kind: String,
}

/// 推给前端的 MONITOR 命令事件。
#[derive(Clone, Serialize)]
struct MonitorEvent {
    id: String,
    command: String,
    db: u8,
    client: String,
    timestamp: f64,
}

/// 取该连接的 fred 连接配置（注入钥匙串密码；经 SSH 隧道则指向本地端口）。
/// 与主连接同款——订阅器/MONITOR 都走独立连接，但复用同一凭据与（若有）隧道。
async fn build_fred_cfg(
    state: &State<'_, AppState>,
    id: &str,
) -> Result<FredConnectConfig, AppError> {
    let cfg = {
        let cfgs = state.configs.lock().await;
        cfgs.iter().find(|c| c.id == id).cloned()
    }
    .ok_or_else(|| AppError::Config(format!("找不到连接配置 {id}")))?;

    let store = state.store.clone();
    let id_for_keyring = id.to_string();
    let password = tokio::task::spawn_blocking(move || store.get_password(&id_for_keyring))
        .await
        .map_err(|e| AppError::Other(format!("钥匙串任务失败: {e}")))??;
    let mut cfg = cfg;
    cfg.password = password;

    if let Some(t) = state.tunnels.lock().await.get(id) {
        Ok(FredConnectConfig {
            url: tunnel_fred_url(&cfg.username, &cfg.password, t.local_port, cfg.db),
            timeout_secs: 5,
        })
    } else {
        Ok(cfg.to_fred())
    }
}

/// 去重合并（保持顺序）。
fn merge_unique(dst: &mut Vec<String>, items: &[String]) {
    for x in items {
        if !dst.iter().any(|d| d == x) {
            dst.push(x.clone());
        }
    }
}

/// 订阅频道（SUBSCRIBE）和/或模式（PSUBSCRIBE）。首次为该连接建立订阅器并启动转发。
#[tauri::command]
pub async fn pubsub_subscribe(
    id: String,
    channels: Vec<String>,
    patterns: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), AppError> {
    // 取出（或新建）订阅器，操作后放回——避免跨 .await 持锁。
    let mut handle = state.subscribers.lock().await.remove(&id);
    if handle.is_none() {
        let cfg = build_fred_cfg(&state, &id).await?;
        let (sub, mut rx) = PubsubSubscriber::connect(cfg).await?;
        let app2 = app.clone();
        let id2 = id.clone();
        let drain = tauri::async_runtime::spawn(async move {
            while let Some(m) = rx.recv().await {
                let _ = app2.emit(
                    "pubsub-message",
                    PubsubEvent {
                        id: id2.clone(),
                        channel: m.channel,
                        value: m.value,
                        kind: m.kind,
                    },
                );
            }
        });
        handle = Some(PubsubHandle {
            sub,
            subs: Vec::new(),
            patterns: Vec::new(),
            drain,
        });
    }
    let mut handle = handle.expect("订阅器已建立");
    if !channels.is_empty() {
        handle.sub.subscribe(channels.clone()).await?;
        merge_unique(&mut handle.subs, &channels);
    }
    if !patterns.is_empty() {
        handle.sub.subscribe_patterns(patterns.clone()).await?;
        merge_unique(&mut handle.patterns, &patterns);
    }
    state.subscribers.lock().await.insert(id, handle);
    Ok(())
}

/// 取消订阅。
#[tauri::command]
pub async fn pubsub_unsubscribe(
    id: String,
    channels: Vec<String>,
    patterns: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let mut handle = match state.subscribers.lock().await.remove(&id) {
        Some(h) => h,
        None => return Ok(()),
    };
    if !channels.is_empty() {
        handle.sub.unsubscribe(channels.clone()).await?;
        handle.subs.retain(|c| !channels.iter().any(|x| x == c));
    }
    if !patterns.is_empty() {
        handle.sub.unsubscribe_patterns(patterns.clone()).await?;
        handle.patterns.retain(|p| !patterns.iter().any(|x| x == p));
    }
    state.subscribers.lock().await.insert(id, handle);
    Ok(())
}

/// 发布消息（PUBLISH），返回收到该消息的订阅客户端数。
#[tauri::command]
pub async fn pubsub_publish(
    id: String,
    channel: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    let gw = state
        .connections
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or(AppError::NotConnected)?;
    gw.publish(&channel, &message).await
}

/// 开启 MONITOR（独立连接）。重复调用幂等。仅 centralized。
#[tauri::command]
pub async fn monitor_start(
    id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), AppError> {
    if state.monitors.lock().await.contains_key(&id) {
        return Ok(());
    }
    let cfg = build_fred_cfg(&state, &id).await?;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<MonitorCmd>(256);
    let run = tauri::async_runtime::spawn(async move {
        let _ = run_monitor(cfg, tx).await; // 阻塞直到停止/出错
    });
    let app2 = app.clone();
    let id2 = id.clone();
    let drain = tauri::async_runtime::spawn(async move {
        while let Some(c) = rx.recv().await {
            let _ = app2.emit(
                "monitor-command",
                MonitorEvent {
                    id: id2.clone(),
                    command: c.command,
                    db: c.db,
                    client: c.client,
                    timestamp: c.timestamp,
                },
            );
        }
    });
    state
        .monitors
        .lock()
        .await
        .insert(id, MonitorHandle { run, drain });
    Ok(())
}

/// 停止 MONITOR。
#[tauri::command]
pub async fn monitor_stop(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    if let Some(h) = state.monitors.lock().await.remove(&id) {
        h.run.abort();
        h.drain.abort();
    }
    Ok(())
}

/// 断开连接时清理：停止该连接的订阅器与 MONITOR（main.rs disconnect 调用）。
pub async fn cleanup(state: &State<'_, AppState>, id: &str) {
    if let Some(h) = state.subscribers.lock().await.remove(id) {
        h.drain.abort();
        // h.sub drop 关闭订阅连接 + abort 内部转发任务
    }
    if let Some(h) = state.monitors.lock().await.remove(id) {
        h.run.abort();
        h.drain.abort();
    }
}
