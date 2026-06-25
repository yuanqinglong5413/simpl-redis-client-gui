# ADR-002：凭据持久化（本地固定密钥对称加密）

- **状态**：已采纳（Accepted，修订版）
- **日期**：2026-06-23（初版）/ 2026-06-23（修订：改用本地加密，取代钥匙串）
- **关联里程碑**：M1、M3 后续反馈
- **关联文档**：[PRD](../PRD.md) 安全章节、[ADR-001](ADR-001-redis-driver-selection.md)

> **变更说明**：初版选用系统钥匙串（keyring crate）。基于用户反馈改为**本地固定密钥对称加密**
> （自包含、无系统授权框、无 libdbus 依赖）。下文为**当前**决策；原 keyring 方案的权衡见末尾「历史」。

## 背景（Context）

需要让保存的连接能跨重启自动重连，同时满足 PRD 安全要求：

1. **密码绝不明文落盘**；
2. **密码绝不回传前端**（IPC 响应里不能出现）；
3. 重启后可恢复。

用户在实际使用中反馈：系统钥匙串（macOS Keychain）首次写入会弹授权框、Linux 需 libdbus，
且希望凭据**自包含在 app 数据目录**（便于备份/迁移、无 OS 依赖）。故改为本地对称加密。

## 决策（Decision）

1. **配置落盘 + 密码加密存储，分离文件**：
   - 非密码字段写 app 配置目录的 `connections.json`。
   - 密码用 **AES-256-GCM**（项目固定密钥）加密后写 `passwords.enc`，内容为 base64( nonce[12] ‖ ciphertext+tag )，
     明文是 `id → 密码` 的 JSON map。

2. **固定密钥派生**：`key = SHA256(b"redis-client::cred::v1")`（嵌入二进制）。

3. **nonce = SHA256(明文)[:12]**（确定性、不重复）：
   - 不同明文 → 不同 nonce（SHA-256 抗碰撞），**绝不发生 nonce 复用**；
   - 同明文重写 → 同 nonce 同密文（无信息泄露）；
   - 因此**无需引入 RNG 依赖**。

4. **`ConnectionConfig.password` 仍带 `#[serde(default, skip_serializing)]`**：
   - 反序列化（`save` 输入）能接收密码；序列化（落盘 JSON / `list` 响应）一律剔除。
   - `list_connections` 返回的配置**不含密码**；`connections.json` 也不含。

5. **持久化在 `src-tauri`**（沿用 ADR-001 分层：加密/文件 IO 是应用基础设施，核心库保持纯 Redis 访问）。
   `ConnectionStore` 方法同步，调用处 `spawn_blocking` 卸载。

## 安全说明（重要，见末尾「历史/权衡」）

**固定密钥嵌入二进制 → 可被提取**。本方案的防护边界：

| 威胁 | 是否防 |
| --- | --- |
| 配置/密码文件被随手翻看、拷贝、备份泄露 | ✅ 防（密文，非明文） |
| 同机器上其它进程读 app 配置目录 | ✅ 防（密文） |
| 同时拿到 **app 二进制 + 密码文件** 的定向破解 | ❌ 不防（密钥可从二进制提取） |

这与「轻量、自包含、无系统依赖」的产品定位一致。`passwords.enc` 仍是密文（非明文），
满足 PRD「密码绝不明文落盘」；但**不是**对抗定向攻击的强保护。

## 落地位置

- `src-tauri/src/connection_store.rs`：`ConnectionStore`（`connections.json` + `passwords.enc`，AES-256-GCM，全同步）。
  - `load_all`/`save_all`（配置，password 因 skip_serializing 不落盘）。
  - `get_password`/`set_password`/`delete_password`（加密 map，原子写）。
- `src-tauri/src/state.rs`：`password` 字段 `#[serde(default, skip_serializing)]`。
- `src-tauri/src/main.rs`：`.setup()` 注入 store + 启动加载；`save/delete/connect/test_connection` 经 `spawn_blocking` 落盘/读写密码；
  **测试连接**（`test_connection`）在编辑已存连接、密码为空时回退取存储密码（修「编辑时测试验证失败」）。
- 配置/密码文件：`~/Library/Application Support/com.redis-client.app/`（macOS）下的 `connections.json` 与 `passwords.enc`。

## 验证

- 单测 `password_encrypt_roundtrip`（`cargo test -p redis-app`）：加密→解密往返、多条共存、删除幂等、密码文件不含明文。
- 单测 `password_never_serialized` 等：`connections.json` 与 IPC 响应均不含 password 字段。

## 历史 / 权衡（为何不继续用钥匙串）

| 维度 | 钥匙串（原方案） | 本地固定密钥加密（现方案） |
| --- | --- | --- |
| 安全强度 | 强（硬件级 Secure Enclave / DPAPI） | 弱-中（密钥在二进制，可提取） |
| 系统授权框 | macOS 首次写入会弹 | 无 |
| Linux 依赖 | 需 libdbus（secret-service） | 无 |
| 自包含/可备份 | 凭据分散在 OS | 单目录文件，易备份/迁移 |
| 依赖 | `keyring` + 平台后端特性 | `aes-gcm` + `sha2` + `base64`（纯 Rust） |

**用户权衡后接受安全降级**，换取自包含与无打扰。若未来需要更强保护，可平滑切换为
「钥匙串存主密钥 + 本地加密」（混合方案）——只需改 `ConnectionStore::cipher()` 的密钥来源。
