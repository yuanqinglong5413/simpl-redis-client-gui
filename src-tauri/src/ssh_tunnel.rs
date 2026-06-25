//! SSH 隧道：经堡垒机用「本地端口转发」（`-L` 语义）连内网 Redis。
//! russh 为纯 Rust SSH 客户端（无 libssh2 原生依赖）。
//! 对 fred 透明：fred 连 127.0.0.1:本地端口，每个连接经一条 SSH direct-tcpip channel 转发到 Redis。
use std::sync::Arc;

use async_trait::async_trait;
use russh::client;
use russh::keys;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;

use redis_core::AppError;

/// SSH 认证方式。`password`/`passphrase` 为敏感字段，`#[serde(skip_serializing)]`
/// 确保其永不进 connections.json / IPC 响应；仅 save 输入方向接收，落盘走加密 store。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SshAuth {
    Password {
        #[serde(default, skip_serializing)]
        password: String,
    },
    PrivateKey {
        /// 私钥文件路径（如 ~/.ssh/id_rsa）。非敏感，随配置落盘。
        key_path: String,
        #[serde(default, skip_serializing)]
        passphrase: Option<String>,
    },
}

/// SSH 隧道配置（堡垒机）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
}

/// russh 客户端 Handler：接受任意主机密钥。
/// TODO(security): 接 known_hosts / 首次信任，当前有 MITM 风险（与「开发友好」定位权衡）。
struct AcceptAllHandler;

#[async_trait]
impl client::Handler for AcceptAllHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// 打开的隧道句柄：`close()` 关闭本地监听 + 断 SSH 会话。
pub struct TunnelHandle {
    pub local_port: u16,
    ssh: Arc<client::Handle<AcceptAllHandler>>,
    accept_abort: tokio::task::AbortHandle,
}

impl TunnelHandle {
    pub async fn close(self) {
        self.accept_abort.abort();
        let _ = self
            .ssh
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
    }
}

/// 建立 SSH 隧道，返回本地端口。每个连入本地端口的连接会被转发到 `redis_host:redis_port`。
pub async fn open(
    ssh: &SshTunnelConfig,
    redis_host: &str,
    redis_port: u16,
) -> Result<TunnelHandle, AppError> {
    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, (ssh.host.as_str(), ssh.port), AcceptAllHandler)
        .await
        .map_err(|e| AppError::from_display(e.to_string()))?;

    // 认证（密码 / 私钥文件）。
    let ok: bool = match &ssh.auth {
        SshAuth::Password { password } => handle
            .authenticate_password(&ssh.user, password)
            .await
            .map_err(|e| AppError::from_display(e.to_string()))?,
        SshAuth::PrivateKey {
            key_path,
            passphrase,
        } => {
            let pair = keys::decode_secret_key(key_path, passphrase.as_deref())
                .map_err(|e| AppError::from_display(e.to_string()))?;
            handle
                .authenticate_publickey(&ssh.user, Arc::new(pair))
                .await
                .map_err(|e| AppError::from_display(e.to_string()))?
        }
    };
    if !ok {
        return Err(AppError::Other("SSH 认证失败".into()));
    }
    // Handle 非 Clone，包 Arc 供 accept 循环与各 pump 任务共享（方法均为 &self）。
    let handle = Arc::new(handle);

    // 本地随机端口监听。
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::from_display(e.to_string()))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| AppError::from_display(e.to_string()))?
        .port();

    // accept 循环：每个本地连接 → 一条 direct-tcpip channel → 双向透传。
    let redis_host = redis_host.to_string();
    let h = handle.clone();
    let task = tokio::spawn(async move {
        loop {
            let (mut tcp, _) = match listener.accept().await {
                Ok(x) => x,
                Err(_) => break,
            };
            let h = h.clone();
            let rh = redis_host.clone();
            tokio::spawn(async move {
                let channel = match h
                    .channel_open_direct_tcpip(&rh, redis_port as u32, "127.0.0.1", 0)
                    .await
                {
                    Ok(c) => c,
                    Err(_) => return,
                };
                let mut stream = channel.into_stream();
                // 任一端关闭即结束；忽略错误。
                let _ = tokio::io::copy_bidirectional(&mut tcp, &mut stream).await;
            });
        }
    });

    Ok(TunnelHandle {
        local_port,
        ssh: handle,
        accept_abort: task.abort_handle(),
    })
}
