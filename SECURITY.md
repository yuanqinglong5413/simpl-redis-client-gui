# 安全策略 / Security Policy

## 凭据处理（本应用的核心安全设计）

| 项 | 处理方式 |
| --- | --- |
| 连接密码（Redis / SSH） | 本地 **AES-256-GCM 加密** 后存于应用配置目录 `passwords.enc`；**绝不**明文落盘 |
| `connections.json` | 仅存非敏感字段；`password` 字段 `#[serde(skip_serializing)]`，**永不**出现在磁盘 JSON |
| IPC 响应（`list_connections` 等） | **不回传密码**（同上 skip_serializing） |
| SSH 敏感凭据 | 加密存于前缀键 `ssh:pass::{id}` / `ssh:keypass::{id}` |
| 内存态 | 应用内存中不长期持有密码；连接时从加密 store 临时取回注入局部变量 |

密码「留空保存」语义 = 保留现有加密条目（编辑连接时密码框不回填，避免无谓传输）。

## 已知权衡（请知悉）

- **加密用项目固定密钥**（非用户主密码派生）：能防御「随手翻看 / 拷贝配置目录」的被动窥探，**不能**防御「拿到应用二进制并定向破解」的攻击者。详见 [ADR-002](docs/decisions/ADR-002-credential-persistence.md)。如需更强防护，未来可改为 OS 钥匙串（macOS Keychain / Windows Credential Manager）或用户口令派生密钥。
- **SSH 主机密钥校验当前为「全部接受」**（`check_server_key` accepts all）：存在中间人风险。计划引入 known_hosts 校验（TODO）。

## 报告漏洞

如果你发现安全漏洞：

1. **请勿在公开 Issue 中披露**。
2. 私下联系维护者（优先 GitHub 的私密安全通告 / Security Advisories，或邮件）。
3. 请附：影响范围、复现步骤、建议修复（可选）。

我们会在合理时间内确认并修复，修复后再公开披露。

## 安全相关单测

- `connection_store::tests::password_never_serialized` —— 守护「密码不进序列化串」这一核心不变量。改动凭据相关代码后务必保持其通过。
