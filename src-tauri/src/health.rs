//! 连接健康探测：每条活跃连接一个后台任务，周期 ping 检测连通性，
//! 状态变化时经 Tauri 事件 `conn-health` 推前端（state ∈ ok/reconnecting/down）。
//!
//! 与 fred 的重连策略（fred_gateway 里配的 ReconnectPolicy）配合：fred 负责自愈重连，
//! 本任务负责「把连通状态告诉用户」。任务在 disconnect / delete_connection 时 abort。
use std::time::{Duration, Instant};

use redis_core::RedisGateway;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;

use crate::state::{AppState, HealthHandle};

/// 推给前端的连接健康事件。
#[derive(Clone, Serialize)]
struct ConnHealth {
    id: String,
    /// "ok" | "reconnecting" | "down"
    state: String,
    /// 最近一次成功 ping 的往返延迟（ms）；非 ok 态为 None。
    latency: Option<u64>,
}

/// 探测间隔。短于 fred 的连接超时，以便掉线后较快感知。
const INTERVAL: Duration = Duration::from_secs(5);
/// 连续失败到此次数判为 down（之前为 reconnecting）。
const DOWN_THRESHOLD: u32 = 3;

/// 为一条连接启动健康探测任务，返回句柄存入 state。
pub fn spawn(id: String, gw: std::sync::Arc<redis_core::FredGateway>, app: AppHandle) -> HealthHandle {
    let task = tauri::async_runtime::spawn(async move {
        let mut fails: u32 = 0;
        let mut last = String::from("ok"); // 初始视为 ok（刚连上）
        loop {
            let t0 = Instant::now();
            match gw.dbsize().await {
                Ok(_) => {
                    let latency = t0.elapsed().as_millis() as u64;
                    fails = 0;
                    if last != "ok" {
                        last = "ok".into();
                        let _ = app.emit(
                            "conn-health",
                            ConnHealth {
                                id: id.clone(),
                                state: "ok".into(),
                                latency: Some(latency),
                            },
                        );
                    }
                }
                Err(_) => {
                    fails = fails.saturating_add(1);
                    let cur = if fails >= DOWN_THRESHOLD { "down" } else { "reconnecting" };
                    if last != cur {
                        last = cur.into();
                        let _ = app.emit(
                            "conn-health",
                            ConnHealth {
                                id: id.clone(),
                                state: cur.into(),
                                latency: None,
                            },
                        );
                    }
                }
            }
            sleep(INTERVAL).await;
        }
    });
    HealthHandle { task }
}

/// 断开连接时清理：停止该连接的健康探测任务（disconnect / delete_connection 调用）。
pub async fn cleanup(state: &AppState, id: &str) {
    if let Some(h) = state.health.lock().await.remove(id) {
        h.task.abort();
    }
}
