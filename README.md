# Simple Redis Client GUI

> 跨平台 Redis GUI 管理软件 —— 轻量、好看、开源，基于 Tauri 2 + Rust + React。

[![CI](https://github.com/<owner>/redis-client/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![rust](https://img.shields.io/badge/Rust-stable-orange)](https://www.rust-lang.org/)
[![tauri](https://img.shields.io/badge/Tauri-2-success)](https://v2.tauri.app/)

> 🌐 README 与 UI 当前为中文；英文 / i18n 支持开发中。

## ✨ 功能特性

**连接管理**
- 连接分组、SSH 隧道（russh，堡垒机连内网 Redis）、TLS、用户名/密码
- 凭据本地 **AES-256-GCM 加密**存储，密码永不落盘明文、永不出现在 IPC 响应（单测守护）
- 可折叠侧栏（图标轨）

**Key 浏览**
- 平铺 / 命名空间树视图（按分隔符切分，默认 `:`）；可拖拽列表/值分隔
- 搜索：模糊（自动前缀匹配，自动补 `*`）/ 完全匹配；类型过滤；DB 切换
- SCAN 游标分页 + pipeline 批量取 TYPE/TTL（N+1 → 1 次往返）
- **平铺列表虚拟滚动**（`@tanstack/react-virtual`），上万 key 不卡
- 右键菜单：复制名 / 只看本目录 / 查看大小 / **重命名** / **复制为副本** / **目录批量设 TTL** / 删除 / 删目录
- 键盘 ↑/↓ 导航

**值查看与编辑**
- 多标签并行查看多个 key；每个标签独立自动刷新（默认 2s，可调）+ 手动刷新 + TTL 实时倒计时
- **大集合值分页**（List/Hash/Set/ZSet/Stream 每页 200，按类型语义翻页/跳页）
- String：CodeMirror 6 代码编辑器（JSON 高亮 + 实时校验 / 文本）、格式化·原始·Base64·Hex 视图、**JSON 折叠树 + 点击复制 `$.path`**
- Hash/List/Set/ZSet 结构化增删改；写后刷新当前页

**运维面板**
- **内存分析**：扫描当前 db，列出占用最大的 key + 总量
- **服务器监控**：实时 INFO 指标（内存/连接/ops/命中率/各 db key 数）+ 慢日志
- **内嵌 CLI**（xterm.js）：危险命令（`FLUSHALL`/`SHUTDOWN`/`CONFIG`/`KEYS *`）二次确认
- 底部状态栏：模式 · Redis 版本 · db · key 数 · 延迟

## 📸 截图

<!-- TODO: 发布前补充应用截图（连接列表 / Key 浏览 / 值编辑 / 内存分析 / 监控）。 -->
![screenshot](docs/screenshots/placeholder.png)

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 后端 | Rust + [fred](https://github.com/aembke/fred.rs)（Redis 客户端）+ tokio |
| SSH 隧道 | [russh](https://github.com/warptech/russh)（纯 Rust） |
| 凭据 | 本地 AES-256-GCM 加密（固定密钥，见 [ADR-002](docs/decisions/ADR-002-credential-persistence.md)） |
| 前端 | React 18 + TypeScript + Vite 6 + Tailwind CSS |
| 代码编辑器 | CodeMirror 6（懒加载） |
| 工程 | Cargo workspace（核心库独立可测） |

## 架构

```
┌─────────────── 前端 (WebView, React + TS) ───────────────┐
│  invoke('scan_keys' | 'get_key_detail' | 'write_key'…)   │
└──────────────────────────▲───────────────────────────────┘
                           │ Tauri IPC
┌──────────────────────────┴───────────────────────────────┐
│  src-tauri（应用层）：命令 + AppState(连接池/隧道)         │
│                 │ 仅依赖 RedisGateway trait                │
└─────────────────▼──────────────────────────────────────────┘
┌──────────── crates/redis-core（不依赖 Tauri，可独立测试） ───┐
│  RedisGateway (trait)  ◀── FredGateway (fred 实现，唯一耦合) │
│  领域类型 / AppError                                        │
└─────────────────────────────▼───────────────────────────────┘
                               │ TCP / TLS / SSH Tunnel
                          ┌────┴────┐
                          │  Redis  │
                          └─────────┘
```

**关键设计**：上层只依赖 `RedisGateway` trait，**绝不直接 import fred 类型**。fred 仅活在 `fred_gateway.rs` 一个文件里（[ADR-001](docs/decisions/ADR-001-redis-driver-selection.md) 风险对冲）。

## 快速开始

### 依赖

- Rust ≥ 1.77（`rustup`）
- Node.js ≥ 20
- Linux 另需：`libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf`
- Redis（仅集成测试需要）：`brew install redis && brew services start redis`

### 开发模式

```sh
npm install
npm run tauri dev    # 前端热重载 + Rust 后端
```

> 首次 `tauri dev` 编译整个后端（含 tauri）耗时较长，之后增量编译很快。

### 打包发布

```sh
npm run tauri build  # 产出 dmg/msi/AppImage 到 src-tauri/target/release/bundle
```

打 tag（`v0.x.y`）也会触发 [Release 工作流](.github/workflows/release.yml)，自动构建三端安装包并发布草稿 Release。

## 下载安装

前往 [Releases](../../releases) 下载对应平台的安装包（macOS `.dmg` / Windows `.msi` / Linux `.AppImage`）。若无可用版本，按上方「快速开始」从源码构建。

> **macOS 首次打开**：开源项目未购买 Apple 开发者证书，App 未做公证，Gatekeeper 会提示"无法验证开发者"。**右键 App → 打开** → 确认即可；或在终端执行 `xattr -cr "/Applications/Simple Redis Client GUI.app"` 后双击打开。

## 测试

```sh
cargo fmt --all -- --check                       # 格式
cargo clippy --workspace --all-targets -- -D warnings   # 无警告
cargo test -p redis-core --lib                   # 单测
npm run build                                    # tsc 严格类型检查 + vite 构建
```

fred 驱动 Spike（需真实 Redis `127.0.0.1:6379`）：

```sh
cargo test -p redis-core --test spike -- --ignored --nocapture
```

## IPC 命令清单

| 命令 | 说明 |
| --- | --- |
| `ping` | 健康检查 |
| `list_connections` / `save_connection` / `delete_connection` | 连接配置管理 |
| `test_connection` / `connect` / `disconnect` | 测试 / 建立 / 断开连接 |
| `dbsize` / `select_db` | key 数 / 切换 DB |
| `scan_keys` | SCAN 增量分页（cursor/pattern/count/type） |
| `get_key_detail` | key 类型 + TTL + 总数 + 首页值 |
| `read_value_page` | 读集合的一页（list/zset=offset，hash/set=cursor，stream=after_id） |
| `write_key` / `set_ttl` / `delete_key` | 写（WriteOp）/ 设 TTL / 删 key |
| `rename_key` / `copy_key` | 重命名 / 复制 key |
| `key_memory_usage` / `pattern_stats` | 单 key 大小 / 命名空间统计 |
| `delete_by_pattern` / `set_ttl_by_pattern` | 按命名空间删 / 批量设 TTL（危险，前端确认） |
| `analyze_memory` / `server_stats` / `slowlog` | 内存分析 / INFO 统计 / 慢日志 |
| `exec_command` | 任意命令执行（CLI 用） |

## 文档

- 📋 [PRD — 产品需求文档](docs/PRD.md)
- 🧭 [ADR-001 — Redis 驱动选型 (fred vs redis-rs)](docs/decisions/ADR-001-redis-driver-selection.md)
- 🔐 [ADR-002 — 凭据持久化与加密](docs/decisions/ADR-002-credential-persistence.md)
- 🤝 [贡献指南](CONTRIBUTING.md) · 🛡️ [安全策略](SECURITY.md)

## 路线图

- ✅ 连接管理（分组 / SSH 隧道 / TLS / 加密凭据）
- ✅ Key 浏览（树/平铺 / 虚拟滚动 / 搜索过滤 / 右键操作）
- ✅ 值查看编辑（多标签 / 自动刷新 / 大集合分页 / CodeMirror / JSON 树）
- ✅ 运维（内存分析 / 服务器监控 / 慢日志 / 内嵌 CLI）
- ✅ 体验打磨（统一工具栏 / 侧栏折叠 / UI 状态持久化）
- 🔜 **英文 / i18n**、**Pub/Sub + MONITOR**、连接导入/导出、Stream 消费组、断线重连健壮性

## 已知限制

- 加密用项目固定密钥：防随手翻看，不防拿到二进制的定向破解（[ADR-002](docs/decisions/ADR-002-credential-persistence.md)）；后续可接 OS 钥匙串。
- SSH 主机密钥校验当前为「全部接受」（TODO: known_hosts）。
- Stream 仅查看（`XREAD`/消费组 `XGROUP` 留后续）。
- 平铺列表已虚拟化；树视图折叠态 DOM 本就小，暂未虚拟化。
- 暂未内置断线自动重连（连接断开需手动重连）。

## License

[MIT](LICENSE)
