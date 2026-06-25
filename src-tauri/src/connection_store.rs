//! 连接配置持久化 + 密码本地对称加密存储（PRD 安全要求；方案见 ADR-002）。
//!
//! 设计要点：
//! - **非密码字段**写 `connections.json`。`ConnectionConfig.password` 带 `#[serde(skip_serializing)]`，
//!   绝不进 JSON。
//! - **密码**用项目固定密钥 AES-256-GCM 对称加密后写 `passwords.enc`（一个 `id → 密码` 的加密 map）。
//!   仅在 `connect`/测试连接时按需解密取回；取回的密码只活在局部变量，不回填内存状态。
//! - 所有方法同步（文件 IO + 加解密 CPU 均为阻塞）；调用方应在 `spawn_blocking` 中调用。
//!
//! 安全说明（见 ADR-002）：固定密钥嵌入二进制 → 可被提取。本方案防「配置/密码文件被随手翻看/拷贝」，
//! 不防「同时拿到 app 二进制与密码文件的定向破解」。与「轻量、自包含、无系统钥匙串依赖」目标一致。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use redis_core::AppError;
use sha2::{Digest, Sha256};

use crate::state::ConnectionConfig;

/// 配置文件名（非密码字段）。
const FILENAME: &str = "connections.json";
/// 加密密码 map 文件名。
const PW_FILENAME: &str = "passwords.enc";
/// 固定密钥派生种子（见 ADR-002：嵌入二进制，可提取）。
const KEY_SEED: &[u8] = b"redis-client::cred::v1";
/// AES-GCM nonce 长度（96 位 = 12 字节）。
const NONCE_LEN: usize = 12;

/// 连接配置持久化器（线程安全：仅一个 `PathBuf`；`Clone` 仅克隆路径）。
#[derive(Clone)]
pub struct ConnectionStore {
    dir: PathBuf,
}

impl ConnectionStore {
    /// 在 `dir` 下创建存储（自动建目录）。`dir` 通常是 `app_config_dir()`。
    pub fn new(dir: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    fn path(&self) -> PathBuf {
        self.dir.join(FILENAME)
    }

    fn pw_path(&self) -> PathBuf {
        self.dir.join(PW_FILENAME)
    }

    /// 读取全部连接配置。文件不存在视为空列表。
    /// 返回的配置里 `password` 一律为 `None`（磁盘 JSON 本就不含密码，再显式清空做双保险）。
    pub fn load_all(&self) -> Result<Vec<ConnectionConfig>, AppError> {
        let path = self.path();
        match std::fs::read(&path) {
            Ok(bytes) => {
                let mut configs: Vec<ConnectionConfig> = serde_json::from_slice(&bytes)
                    .map_err(|e| AppError::Parse(format!("解析 {FILENAME} 失败: {e}")))?;
                for c in &mut configs {
                    c.password = None;
                }
                Ok(configs)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(AppError::Io(e)),
        }
    }

    /// 全量写入连接配置。`password` 因 `skip_serializing` 不会落盘。
    /// 「写临时文件 + rename」原子写，避免崩溃损坏 `connections.json`。
    pub fn save_all(&self, configs: &[ConnectionConfig]) -> Result<(), AppError> {
        let json = serde_json::to_vec_pretty(configs)
            .map_err(|e| AppError::Parse(format!("序列化连接配置失败: {e}")))?;
        let final_path = self.path();
        let tmp_path = atomic_tmp(&final_path);
        std::fs::write(&tmp_path, json)?;
        std::fs::rename(&tmp_path, &final_path)?;
        Ok(())
    }

    /// 取回某连接的密码；无条目返回 `Ok(None)`。
    pub fn get_password(&self, id: &str) -> Result<Option<String>, AppError> {
        Ok(self.load_pw_map()?.get(id).cloned())
    }

    /// 写入（覆盖）某连接的密码。
    pub fn set_password(&self, id: &str, password: &str) -> Result<(), AppError> {
        let mut map = self.load_pw_map()?;
        map.insert(id.to_string(), password.to_string());
        self.save_pw_map(&map)
    }

    /// 删除某连接的密码；条目不存在视为成功（幂等）。
    pub fn delete_password(&self, id: &str) -> Result<(), AppError> {
        let mut map = self.load_pw_map()?;
        map.remove(id);
        self.save_pw_map(&map)
    }

    /// 读取加密密码 map；文件不存在返回空。
    fn load_pw_map(&self) -> Result<HashMap<String, String>, AppError> {
        match std::fs::read(self.pw_path()) {
            Ok(bytes) => {
                let b64_str = String::from_utf8(bytes)
                    .map_err(|e| AppError::Parse(format!("{PW_FILENAME} 不是合法 UTF-8: {e}")))?;
                let raw = B64
                    .decode(b64_str.trim())
                    .map_err(|e| AppError::Config(format!("{PW_FILENAME} base64 解码失败: {e}")))?;
                if raw.len() < NONCE_LEN {
                    return Ok(HashMap::new());
                }
                let (nonce_bytes, ct) = raw.split_at(NONCE_LEN);
                let nonce = Nonce::from_slice(nonce_bytes);
                let pt = Self::cipher()
                    .decrypt(nonce, ct)
                    .map_err(|e| AppError::Config(format!("密码文件解密失败: {e}")))?;
                serde_json::from_slice(&pt)
                    .map_err(|e| AppError::Parse(format!("密码 map 解析失败: {e}")))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(e) => Err(AppError::Io(e)),
        }
    }

    /// 加密并写入密码 map。nonce = sha256(明文)[:12] —— 确定性但不重复（不同明文 → 不同 nonce），
    /// 避免引入 RNG 依赖。文件布局：base64( nonce[12] || ciphertext+tag )。
    fn save_pw_map(&self, map: &HashMap<String, String>) -> Result<(), AppError> {
        let pt = serde_json::to_vec(map)
            .map_err(|e| AppError::Parse(format!("密码 map 序列化失败: {e}")))?;
        let digest = Sha256::digest(&pt);
        let nonce = Nonce::from_slice(&digest[..NONCE_LEN]);
        let ct = Self::cipher()
            .encrypt(nonce, pt.as_ref())
            .map_err(|e| AppError::Config(format!("密码加密失败: {e}")))?;
        let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
        out.extend_from_slice(&digest[..NONCE_LEN]);
        out.extend_from_slice(&ct);
        Ok(std::fs::write(self.pw_path(), B64.encode(&out))?)
    }

    /// 由固定种子派生的 AES-256-GCM cipher。
    fn cipher() -> Aes256Gcm {
        let key = Sha256::digest(KEY_SEED);
        Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_slice()))
    }
}

/// 生成与目标文件同目录的临时文件路径（用于原子写）。
fn atomic_tmp(final_path: &Path) -> PathBuf {
    let mut p = final_path.to_path_buf();
    let mut name = final_path
        .file_name()
        .map(|s| s.to_os_string())
        .unwrap_or_else(|| std::ffi::OsString::from(FILENAME));
    name.push(".tmp");
    p.set_file_name(name);
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, pw: Option<&str>) -> ConnectionConfig {
        ConnectionConfig {
            id: id.into(),
            name: format!("conn-{id}"),
            host: "127.0.0.1".into(),
            port: 6379,
            username: None,
            password: pw.map(Into::into),
            db: 0,
            tls: false,
            group: None,
            prefs: Default::default(),
            ssh: None,
        }
    }

    fn tmp_store() -> (ConnectionStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("redis-client-test-{}", uuid::Uuid::new_v4()));
        let store = ConnectionStore::new(dir.clone()).unwrap();
        (store, dir)
    }

    /// 核心安全保证：密码绝不进入 connections.json 序列化串。
    #[test]
    fn password_never_serialized() {
        let c = sample("x", Some("s3cret"));
        let json = serde_json::to_string(&c).unwrap();
        assert!(!json.contains("s3cret"), "明文密码泄露到 JSON: {json}");
        assert!(
            !json.contains("password"),
            "password 字段出现在序列化串: {json}"
        );
    }

    #[test]
    fn password_deserializes_on_input() {
        let wire = serde_json::json!({
            "id": "x", "name": "conn-x", "host": "127.0.0.1", "port": 6379,
            "username": null, "password": "s3cret", "db": 0, "tls": false, "group": null
        });
        let back: ConnectionConfig = serde_json::from_value(wire).unwrap();
        assert_eq!(back.password.as_deref(), Some("s3cret"));
    }

    #[test]
    fn tolerates_missing_password_field() {
        let wire = serde_json::json!({
            "id": "x", "name": "conn-x", "host": "127.0.0.1", "port": 6379,
            "username": null, "db": 0, "tls": false, "group": null
        });
        let back: ConnectionConfig = serde_json::from_value(wire).unwrap();
        assert_eq!(back.password, None);
    }

    #[test]
    fn round_trip_disk_has_no_password() {
        let (store, dir) = tmp_store();
        store.save_all(&[sample("x", Some("s3cret"))]).unwrap();
        let raw_str = String::from_utf8(std::fs::read(store.path()).unwrap()).unwrap();
        assert!(!raw_str.contains("password"));
        assert!(!raw_str.contains("s3cret"));
        let loaded = store.load_all().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].password, None);
        assert_eq!(loaded[0].host, "127.0.0.1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_file_is_empty() {
        let (store, dir) = tmp_store();
        assert!(store.load_all().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// #4：加密密码 map 的 加密 → 解密 往返；密码文件不含明文。
    #[test]
    fn password_encrypt_roundtrip() {
        let (store, dir) = tmp_store();
        store.set_password("id1", "hunter2").unwrap();
        assert_eq!(
            store.get_password("id1").unwrap().as_deref(),
            Some("hunter2")
        );

        // 密码文件是 base64 密文，不含明文
        let raw = std::fs::read_to_string(store.pw_path()).unwrap();
        assert!(!raw.contains("hunter2"));

        // 多条共存
        store.set_password("id2", "pw-two").unwrap();
        assert_eq!(
            store.get_password("id1").unwrap().as_deref(),
            Some("hunter2")
        );
        assert_eq!(
            store.get_password("id2").unwrap().as_deref(),
            Some("pw-two")
        );

        // 删除
        store.delete_password("id1").unwrap();
        assert_eq!(store.get_password("id1").unwrap(), None);
        assert_eq!(
            store.get_password("id2").unwrap().as_deref(),
            Some("pw-two")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
