//! MONITOR 流：独立连接跑 `MONITOR`，把命令流转为领域中立的 `mpsc`（上层 `src-tauri` 发事件）。
//! **仅 centralized（单机/哨兵）支持**（fred 限制；集群不支持）。
//! 取消方式：abort 运行任务 / 接收端 drop → 自然停止（cancel-safe）。
use fred::monitor;
use fred::prelude::*;
use tokio::sync::mpsc;
use tokio_stream::StreamExt;

use crate::error::AppError;
use crate::fred_gateway::FredConnectConfig;

/// 一条 MONITOR 命令（领域中立，跨 IPC 传递）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct MonitorCmd {
    /// 完整命令（命令名 + 参数，空格连接）。
    pub command: String,
    /// 命令所在 db。
    pub db: u8,
    /// 发起客户端地址。
    pub client: String,
    /// 服务端时间戳（秒，浮点）。
    pub timestamp: f64,
}

/// 跑 MONITOR 直到被取消（任务 abort）或出错。**阻塞调用**，应在独立任务中运行。
/// 接收端关闭即停止转发。
pub async fn run_monitor(
    cfg: FredConnectConfig,
    tx: mpsc::Sender<MonitorCmd>,
) -> Result<(), AppError> {
    let config = Config::from_url(&cfg.url).map_err(AppError::from_display)?;
    let mut stream = monitor::run(config).await.map_err(AppError::from_display)?;
    while let Some(cmd) = stream.next().await {
        let args = cmd
            .args
            .iter()
            .map(|a| a.clone().convert::<String>().unwrap_or_default())
            .collect::<Vec<_>>()
            .join(" ");
        let command = if args.is_empty() {
            cmd.command
        } else {
            format!("{} {}", cmd.command, args)
        };
        if tx
            .send(MonitorCmd {
                command,
                db: cmd.db,
                client: cmd.client,
                timestamp: cmd.timestamp,
            })
            .await
            .is_err()
        {
            break; // 接收端关闭（停止）
        }
    }
    Ok(())
}
