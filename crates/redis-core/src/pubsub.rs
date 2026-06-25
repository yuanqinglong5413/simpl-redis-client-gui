//! Pub/Sub 订阅器：专用 [`SubscriberClient`]（独立连接，不复用数据连接——
//! Redis 协议下订阅态连接只能 subscribe/unsubscribe/ping/quit，无法跑其它命令）。
//!
//! 把 fred 的 broadcast 消息流转为领域中立的 `mpsc` 流；上层 `src-tauri` 再发 Tauri 事件。
//! **PUBLISH 不走这里**（订阅态连接不能 PUBLISH），由 [`crate::gateway::RedisGateway::publish`]
//! 经普通连接发送。
use fred::clients::SubscriberClient;
use fred::prelude::*;
use fred::types::config::ReconnectPolicy;
use tokio::sync::mpsc;

use crate::error::AppError;
use crate::fred_gateway::FredConnectConfig;

/// 一条发布/订阅消息（领域中立，跨 IPC 传递）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct PubsubMessage {
    /// 频道（模式订阅时为匹配到的实际频道）。
    pub channel: String,
    /// 消息内容（按字符串呈现；非字符串值尽量转文本）。
    pub value: String,
    /// "message" | "pmessage" | "smessage"
    pub kind: String,
}

/// 一个 Pub/Sub 订阅器（独立连接）。drop 时关闭连接并停止转发任务。
pub struct PubsubSubscriber {
    client: SubscriberClient,
    /// fred broadcast → mpsc 转发任务（drop self 时 abort）。
    forward: tokio::task::JoinHandle<()>,
}

impl PubsubSubscriber {
    /// 建立订阅连接 + 启动转发任务；返回 (订阅器, 消息接收端)。
    pub async fn connect(
        cfg: FredConnectConfig,
    ) -> Result<(Self, mpsc::Receiver<PubsubMessage>), AppError> {
        let config = Config::from_url(&cfg.url).map_err(AppError::from_display)?;
        let subscriber = Builder::from_config(config)
            .with_connection_config(|c| {
                c.connection_timeout = std::time::Duration::from_secs(cfg.timeout_secs);
            })
            .set_policy(ReconnectPolicy::new_exponential(u32::MAX, 500, 30_000, 2))
            .build_subscriber_client()
            .map_err(AppError::from_display)?;
        subscriber.init().await.map_err(AppError::from_display)?;

        let (tx, rx) = mpsc::channel::<PubsubMessage>(256);
        let mut message_rx = subscriber.message_rx();
        let forward = tokio::spawn(async move {
            loop {
                match message_rx.recv().await {
                    Ok(m) => {
                        // MessageKind 判别：用 Debug 小写化，避免导入 fred 内部类型路径。
                        let kind = format!("{:?}", m.kind).to_lowercase();
                        let value = m.value.convert::<String>().unwrap_or_default();
                        let channel = m.channel.to_string();
                        if tx
                            .send(PubsubMessage {
                                channel,
                                value,
                                kind,
                            })
                            .await
                            .is_err()
                        {
                            break; // 接收端关闭
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // 广播滞后（消费太慢）：丢弃旧消息继续，不中断
                        continue;
                    }
                    Err(_) => break, // 通道关闭
                }
            }
        });

        Ok((
            Self {
                client: subscriber,
                forward,
            },
            rx,
        ))
    }

    /// 订阅频道（SUBSCRIBE）。
    pub async fn subscribe(&self, channels: Vec<String>) -> Result<(), AppError> {
        let chans: Vec<&str> = channels.iter().map(|s| s.as_str()).collect();
        self.client
            .subscribe(chans)
            .await
            .map_err(AppError::from_display)
    }

    /// 订阅模式（PSUBSCRIBE）。
    pub async fn subscribe_patterns(&self, patterns: Vec<String>) -> Result<(), AppError> {
        let pats: Vec<&str> = patterns.iter().map(|s| s.as_str()).collect();
        self.client
            .psubscribe(pats)
            .await
            .map_err(AppError::from_display)
    }

    /// 取消订阅频道。
    pub async fn unsubscribe(&self, channels: Vec<String>) -> Result<(), AppError> {
        let chans: Vec<&str> = channels.iter().map(|s| s.as_str()).collect();
        self.client
            .unsubscribe(chans)
            .await
            .map_err(AppError::from_display)
    }

    /// 取消订阅模式。
    pub async fn unsubscribe_patterns(&self, patterns: Vec<String>) -> Result<(), AppError> {
        let pats: Vec<&str> = patterns.iter().map(|s| s.as_str()).collect();
        self.client
            .punsubscribe(pats)
            .await
            .map_err(AppError::from_display)
    }
}

impl Drop for PubsubSubscriber {
    fn drop(&mut self) {
        self.forward.abort();
        // SubscriberClient drop 关闭其独立连接。
    }
}
