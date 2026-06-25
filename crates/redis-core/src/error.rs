//! 统一错误模型。
//!
//! fred 等驱动的错误在 gateway 边界统一转为 [`AppError`]，
//! 上层（Tauri 命令层）不感知具体驱动错误类型。

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("连接失败: {0}")]
    Connect(String),

    #[error("命令执行失败: {0}")]
    Command(String),

    #[error("不支持的操作: {0}")]
    Unsupported(String),

    #[error("数据解析失败: {0}")]
    Parse(String),

    #[error("配置错误: {0}")]
    Config(String),

    #[error("连接未建立或已断开")]
    NotConnected,

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// 从任意实现了 `Display` 的错误构造。
    ///
    /// 用于在 gateway 边界把 fred 等驱动错误统一收口，**无需** import 驱动的具体错误类型，
    /// 从而保持本错误模型与驱动解耦。
    pub fn from_display<E: std::fmt::Display>(e: E) -> Self {
        Self::Command(e.to_string())
    }
}

/// Tauri 命令返回 `Result<T, AppError>` 时需要可序列化。
/// 这里将错误序列化为人类可读字符串，前端可直接展示。
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
