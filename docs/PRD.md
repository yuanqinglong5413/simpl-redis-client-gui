# Redis GUI 管理软件 — 产品需求文档 (PRD)

| 项目 | 内容 |
| --- | --- |
| 文档名称 | Redis GUI Client (Rust 实现) |
| 文档版本 | v1.0 |
| 文档状态 | Draft — 待评审 |
| 创建日期 | 2026-06-23 |
| 适用阶段 | 立项 / 架构评审 / MVP 排期 |
| 技术栈 | Tauri 2 + Rust 后端 + Web (React/TS) 前端 |

---

## 0. 修订记录

| 版本 | 日期 | 变更 | 作者 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-23 | 首版 PRD，确立产品方向、架构与 MVP 范围 | — |

---

## 1. 产品概述

### 1.1 背景

Redis 是当下最广泛使用的内存数据库/缓存之一，但官方与第三方的 GUI 工具普遍存在以下痛点：

- **RedisInsight**：功能强但体积大、启动慢、部分高级功能需绑定 Redis Cloud 账号。
- **Another Redis Desktop Manager (ARDM)**：好用但闭源/收费，UI 较旧，Cluster 体验一般。
- **Medis / RDM (Redis Desktop Manager)**：RDM 维护趋缓；Medis 仅 macOS 且对 Cluster/Stack 支持有限。
- **纯命令行 redis-cli**：学习成本高，大量 Key 时浏览/检索/编辑效率低。

市场缺少一个**轻量、跨平台、开源、现代 UI、支持完整 Redis 形态**的桌面客户端。

### 1.2 产品愿景

打造一款**「快、轻、好看、够用且可扩展」**的跨平台 Redis 桌面 GUI，个人开发者开箱即用，小团队也能直接上手，长期通过插件化支持 Redis Stack 等高级特性。

### 1.3 产品目标 (MVP)

1. **可用**：能稳定连接单机 Redis，完成连接管理、Key 浏览检索、5 种基本数据类型的查看与编辑、内嵌 CLI。
2. **好用**：首屏 < 2s 打开，百万级 Key 下浏览/搜索流畅（虚拟滚动 + 服务端 SCAN）。
3. **安全**：连接凭据本地加密存储，支持密码/TLS/SSH 隧道，敏感操作有二次确认。
4. **跨平台**：Windows / macOS / Linux 三端一致的安装包与体验。

### 1.4 非目标 (Non-Goals) — MVP 不做

- ❌ 不做云端 SaaS / 多人实时协作编辑。
- ❌ 不做 Redis 服务端运维（部署、升级、备份调度）。
- ❌ 不做付费墙 / 账号体系 / 许可证管理。
- ❌ 不做移动端 / 纯 Web 版（桌面端优先）。
- ❌ MVP 不支持 Cluster / Sentinel / Redis Stack（列入 P1/P2 路线图）。

### 1.5 成功指标

| 维度 | 指标 | 目标 |
| --- | --- | --- |
| 功能 | MVP 验收用例通过率 | 100% |
| 性能 | 冷启动到可交互 | < 2s |
| 性能 | 10w Key 下首屏 Key 列表加载 | < 500ms |
| 性能 | 内存占用（空闲态） | < 120MB |
| 体积 | 安装包大小 | < 15MB |
| 稳定性 | 连接异常/命令错误不导致白屏崩溃 | 0 致命崩溃 |
| 安全 | 凭据明文落盘 | 0 处 |

---

## 2. 目标用户与场景

### 2.1 用户画像

| 画像 | 占比预估 | 核心诉求 |
| --- | --- | --- |
| 后端/全栈开发者 | ~60% | 快速看 Key、调试缓存值、清理脏数据、跑命令 |
| DevOps / SRE | ~20% | 排查线上缓存问题、查看慢日志、监控内存 |
| 数据/中间件工程师 | ~10% | 验证 Stream/数据结构、批量操作 |
| 学习者/DBA | ~10% | 直观理解 Redis 数据结构与命令 |

### 2.2 核心使用场景

1. **本地开发调试**：连本地 Redis，查/改某个缓存 Key 的值与 TTL，验证业务逻辑。
2. **线上排查**：通过 SSH 隧道连跳板机后的 Redis，按 pattern 搜索可疑 Key，分析大 Key。
3. **批量清理**：按 `prefix:*` 搜索出一批过期脏 Key，勾选后批量删除（带确认）。
4. **结构化数据查看**：查看 Hash/JSON 数据，以表格/JSON 树形式浏览并就地编辑。
5. **命令测试**：在内嵌 CLI 里跑复杂命令（如 Lua、MULTI/EXEC），看返回。

---

## 3. 竞品对标

| 能力 | RedisInsight | ARDM | Medis | **本项目(目标)** |
| --- | :-: | :-: | :-: | :-: |
| 开源 | 部分 | 否 | 否 | ✅ |
| 轻量/启动快 | ❌(重) | ⚠️ | ✅ | ✅ |
| Cluster | ✅ | ⚠️ | ❌ | P1 ✅ |
| Sentinel | ❌ | ❌ | ❌ | P2 ✅ |
| Redis Stack | ✅ | ❌ | ❌ | P2 ✅ |
| SSH/TLS | ✅ | ⚠️ | ❌ | MVP(P0 TLS/SSH) |
| 内嵌 CLI | ✅ | ✅ | ⚠️ | MVP ✅ |
| 现代化 UI | ✅ | ❌(旧) | ✅ | ✅ |

**差异化定位**：开源 + 轻量 + 现代 UI + 完整 Redis 形态覆盖 + 良好的大 Key / 大数据量体验。

---

## 4. 总体技术架构

### 4.1 架构选型：Tauri 2

采用 **Tauri 2 + Rust 后端 + Web 前端** 双层架构。

```
┌──────────────────────────────────────────────────────────┐
│                    前端 (WebView, React + TS)             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐   │
│  │连接管理   │ │Key 浏览   │ │数据编辑   │ │ CLI/Terminal│   │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘   │
│        TanStack Query (数据) / Zustand (UI 状态)          │
└───────────────▲───────────────────────▲──────────────────┘
                │  Tauri IPC            │  Tauri Event (push)
                │  invoke(cmd, args)    │  emit/listen (订阅类)
┌───────────────┴───────────────────────┴──────────────────┐
│                  Rust 后端 (Tauri Commands)                │
│  ┌────────────────────────────────────────────────────┐   │
│  │  应用层: connection / scanner / editor / cli / ...  │   │
│  ├────────────────────────────────────────────────────┤   │
│  │  核心层: Redis Driver (fred) + 连接池 + 命令执行     │   │
│  ├────────────────────────────────────────────────────┤   │
│  │  基础设施: 凭据存储(keyring) / 配置 / 日志 / 加密    │   │
│  └────────────────────────────────────────────────────┘   │
└────────────────────────▲──────────────────────────────────┘
                         │ TCP / TLS / SSH Tunnel
                  ┌──────┴──────┐
                  │  Redis 实例  │ (Standalone / Cluster / Sentinel)
                  └─────────────┘
```

**选型理由（Tauri vs 纯 Rust GUI）**：
- Redis GUI 高度依赖复杂列表/树/表格/Monaco 编辑器/xterm，Web 生态成熟度碾压原生 GUI 框架。
- Tauri 用系统 WebView，安装包 ~8–15MB，内存与启动优于 Electron。
- Rust 后端直接持有连接池与 redis 驱动，性能与原生一致；前端只做展示。
- 主流 Redis GUI（RedisInsight/ARDM）均为 Web 技术栈，UI/UX 可直接借鉴。

### 4.2 进程与线程模型

- 主进程（Rust）：持有 Redis 连接池（tokio），执行所有 Redis 命令，管理凭据与配置。
- WebView 进程：仅渲染与交互，**不直接连 Redis**，所有 I/O 经 IPC 走 Rust。
- 异步：Rust 侧 tokio 多线程运行时；长任务（SCAN、批量删除）通过 Tauri Event 向前端推送进度。

### 4.3 数据流

- **请求（前端 → 后端）**：`invoke("scan_keys", { connId, cursor, match, count })`。
- **响应（后端 → 前端）**：IPC 返回结构化 JSON。
- **流式/推送（后端 → 前端）**：SCAN 分页、批量操作进度、Pub/Sub 消息、CLI 输出，用 `emit` + `listen` 推送。

---

## 5. 技术栈选型（详细）

### 5.1 后端 (Rust)

| 用途 | 选型 | 备选 | 说明 |
| --- | --- | --- | --- |
| 应用框架 | **Tauri 2** | — | 桌面壳 + IPC + 打包 |
| 异步运行时 | **tokio** | async-std | 事实标准 |
| Redis 驱动 | **fred** | redis-rs | fred 原生支持 Cluster、Pipeline、Pub/Sub、Modules、重连，适合本项目全形态目标 |
| 连接池 | fred 内置 / deadpool | bb8 | fred 自带 client pool |
| TLS | **rustls** | native-tls | 纯 Rust，跨平台免依赖 |
| SSH 隧道 | **russh** | thrussh | 纯 Rust SSH 客户端，做端口转发 |
| 凭据加密存储 | **keyring** | 手动 AES + 文件 | 系统钥匙串 (macOS Keychain / Win Credential Manager / Linux Secret Service) |
| 配置持久化 | **serde + serde_json** | toml | 连接配置、偏好设置 |
| 错误处理 | **thiserror + anyhow** | — | 库 thiserror，应用 anyhow |
| 日志/追踪 | **tracing + tracing-subscriber** | log | 结构化日志，便于排查 |
| 随机/加密 | **rand + aes-gcm** | — | 仅在 keyring 不可用时降级 |

### 5.2 前端 (Web)

| 用途 | 选型 | 备选 | 说明 |
| --- | --- | --- | --- |
| 框架 | **React 18 + TypeScript** | Vue 3 | Monaco/xterm 在 React 生态集成最成熟；团队招聘面广 |
| 构建 | **Vite** | — | Tauri 官方推荐 |
| 样式 | **Tailwind CSS** | — | 原子化，快 |
| 组件库 | **shadcn/ui (Radix + Tailwind)** | Ant Design | 轻量、可定制、现代观感，契合「轻量好看」定位 |
| 状态管理 | **Zustand** (UI) + **TanStack Query** (服务端数据) | Redux/Jotai | Query 负责缓存/重试/失效，Zustand 管本地 UI 状态 |
| 代码编辑器 | **@monaco-editor/react** | CodeMirror | JSON/Text/Lua 值编辑 |
| 终端 | **xterm.js** | — | 内嵌 CLI |
| 图标 | **lucide-react** | — | 统一图标体系 |
| 虚拟滚动 | **TanStack Virtual** | react-window | 百万 Key 流畅滚动 |
| i18n | **react-i18next** | — | 中英文，可扩展 |

> React vs Vue 说明：本项目主推 **React + TS**（生态、Monaco/xterm 集成、社区案例）。如团队更强 Vue，可整体替换为 Vue 3 + Pinia + VueUse，对 PRD 其余部分无影响。

### 5.3 通讯约定

- 所有跨端调用统一走 Tauri Command，命名 `snake_case`，参数与返回均为可序列化结构。
- 统一错误模型：后端返回 `Result<T, AppError>`，前端通过 `invoke` 捕获并走统一 toast/通知。
- 长任务/推送统一走 Event，前端用 `listen` 订阅，频道命名 `conn://{id}/...`。

### 5.4 构建与发布

- CI：GitHub Actions，三端交叉编译（macOS Intel+ARM、Windows x64、Linux AppImage/deb）。
- 产物：`.dmg` / `.msi` / `.AppImage` + 自动更新（Tauri Updater + 签名）。
- 代码签名：macOS notarize、Windows Authenticode（路线图内规划）。

---

## 6. 功能规格

按优先级分三层：**P0 (MVP)** → **P1** → **P2**。

### 6.1 P0 — MVP 核心功能

#### F-CON 连接管理（必选）

**描述**：新增/编辑/删除/测试 Redis 连接配置，加密保存，连接/断开，多连接并行。

**功能点**：
- 连接配置字段：`名称`、`Host`、`Port`、`Username (ACL)`、`Password`、`Database (0–15)`、`TLS 开关`、`SSH 隧道配置 (P0 内含)`、`连接超时`、`备注`。
- **测试连接** 按钮：点击后实际握手并返回版本/角色/连通性，成功/失败均给明确反馈。
- 连接列表：分组（文件夹）、排序、搜索、最近使用置顶。
- 凭据加密：Password 存系统钥匙串；其余配置存明文 JSON。
- 连接状态：在线/连接中/错误 三态，顶部状态栏可见。
- 多连接：支持同时打开多个连接，左侧 Tab 切换。

**验收**：
- [ ] 新建→填表→测试连接→保存→双击连接成功进入工作区。
- [ ] 重启应用后凭据仍可用且不可在配置文件中看到明文密码。
- [ ] 错误密码/不可达地址时给出友好提示，不崩溃。

#### F-KEY Key 浏览与搜索

**描述**：Database 切换、Key 列表、按 pattern 搜索、排序、TTL/类型展示、虚拟滚动。

**功能点**：
- 顶部 DB 切换器（SELECT 0–15，显示各 DB 的 key 数量近似 `DBSIZE`）。
- Key 列表：基于 `SCAN`（非 `KEYS`）增量分页，**绝不一次性 `KEYS *`**。
- 搜索：支持 `match` glob pattern（如 `user:*`），输入即触发防抖搜索。
- 每行展示：Key 名、类型（icon）、TTL（倒计时 / 持久 / 即将过期）、大小（`MEMORY USAGE`，可选）。
- 排序：按名称、按 TTL。
- 虚拟滚动：支持 10w+ Key 流畅滚动。
- 右键菜单：复制 Key 名、重命名（`RENAME`）、删除（`DEL`，带确认）、设置 TTL/取消 TTL（`EXPIRE`/`PERSIST`）、在新 Tab 打开值。
- 刷新策略：手动刷新 + 可选自动刷新（轮询间隔）。

**验收**：
- [ ] 在含 10w Key 的 DB 中，打开列表 < 500ms，滚动不卡顿。
- [ ] `user:*` 搜索能命中并以分页方式返回，不阻塞 UI。
- [ ] 删除 Key 前有二次确认；删除后列表实时更新。

#### F-DATA 数据查看与编辑

**描述**：查看并就地编辑 String / Hash / List / Set / ZSet / Stream（基本结构），支持原始/格式化视图。

**功能点**：
- **String**：文本/JSON/二进制(hex) 切换；JSON 自动美化与校验；长度超阈值用 Monaco 分页编辑。
- **Hash**：表格视图（field/value），新增/编辑/删除单 field（`HSET`/`HDEL`），value 支持 JSON 格式化。
- **List**：元素列表，按 index 查看与编辑（`LSET`），头部/尾部插入（`LPUSH`/`RPUSH`），按 index 删除。
- **Set**：成员列表，增删成员（`SADD`/`SREM`），分页（`SSCAN`）。
- **ZSet**：成员+score 表格，增删改（`ZADD`/`ZREM`），按 score/member 排序。
- **Stream**：ID+entry 列表，按范围读取（`XRANGE`/`XREVRANGE`），追加（`XADD`）。
- **通用**：新建 Key（选择类型→填值）；复制值；大值只加载片段，避免 OOM。
- 编辑保存走「乐观锁」：保存前用 `WATCH` 或类型校验，避免覆盖并发修改（至少给出冲突提示）。

**验收**：
- [ ] 5 种基本类型均可查看/新增/修改/删除元素并持久化到 Redis。
- [ ] String 值为合法 JSON 时自动美化；非法 JSON 高亮错误位置。
- [ ] 并发修改冲突时给出提示而非静默覆盖。

#### F-CLI 内嵌 CLI / Terminal

**描述**：xterm.js 内嵌交互式命令行，逐条执行命令，支持历史与补全。

**功能点**：
- 命令输入 → 经 Rust 执行 → 结果回显（RESP 原始/格式化可切）。
- 命令历史：上下键翻阅，持久化到本地（按连接）。
- 命令补全：常用命令 + Key 名补全（Tab）。
- 危险命令拦截：`FLUSHALL`/`FLUSHDB`/`CONFIG`/`SHUTDOWN`/`KEYS *` 默认二次确认（可在设置关闭）。
- 多 Tab：每个连接可开多个 CLI 实例。
- 支持 `SUBSCRIBE`/`PSUBSCRIBE`：进入订阅态，消息流式推送至终端（P1 完善）。

**验收**：
- [ ] `SET k v` / `GET k` / `HSET ...` 等命令可执行并正确回显。
- [ ] `FLUSHDB` 触发确认弹窗，取消则不执行。
- [ ] 上下键可翻阅本会话历史命令。

---

### 6.2 P1 — 扩展能力（MVP 之后第一批）

| ID | 功能 | 说明 |
| --- | --- | --- |
| F-CLUS | **Cluster 集群** | 自动发现节点（`CLUSTER NODES`/`SLOTS`），按 slot/节点分组展示 Key，跨节点命令自动重定向（fred 原生支持），节点健康拓扑图 |
| F-SLOW | **慢日志** | `SLOWLOG GET` 可视化列表，按时长/命令过滤 |
| F-INFO | **服务器信息** | `INFO` 分区展示（内存/连接/命中率/持久化），关键指标图表 |
| F-MON | **MONITOR/实时流** | 订阅实时命令流（开发调试用），可暂停/过滤 |
| F-EXP | **导入/导出** | 导出选定 Key 为 RDB dump 或 JSON；从 JSON 批量导入 |
| F-SCAN2 | **大 Key 分析** | 基于 `SCAN` + `MEMORY USAGE` 扫描统计大 Key/前缀分布 |
| F-TTL | **批量 TTL 操作** | 批量设 TTL、批量删除（带进度条与可中断） |
| F-FAV | **收藏夹 / 常用 Key** | 标记常用 Key，快速跳转 |

---

### 6.3 P2 — 高级特性

| ID | 功能 | 说明 |
| --- | --- | --- |
| F-SENT | **Sentinel 哨兵** | 查看 master/replica/sentinel 拓扑、故障转移状态 |
| F-STACK | **Redis Stack 模块** | RedisJSON（JSON 树编辑 + JSONPath 查询）、RediSearch（索引/查询构建器）、TimeSeries、Bloom/Cuckoo/HLL 滤波器可视化 |
| F-PERF | **内存/性能监控** | 持续采样并绘制内存、QPS、命中率曲线（本地采样，非侵入） |
| F-PLUG | **插件系统** | 提供 JS/TS 扩展点（自定义命令面板、自定义值渲染器） |
| F-THEME | **主题 / 国际化** | 明暗主题、自定义强调色、完整 i18n |
| F-CMD | **命令面板 (Cmd+K)** | 全局快速跳转/执行命令 |
| F-DIFF | **环境对比/同步** | 两个连接间 Key 对比、选择性同步 |

---

## 7. 信息架构与 UI/UX

### 7.1 主界面布局

```
┌─────────────────────────────────────────────────────────────┐
│  顶栏: [Logo] [连接切换▼] [DB▼] [搜索框]      [CLI][设置][…] │
├──────────┬──────────────────────────┬────────────────────────┤
│          │                          │                        │
│ 左侧栏    │   中间: Key 列表          │   右侧: 值查看/编辑面板 │
│ 连接树    │   (虚拟滚动 + 类型/TTL)   │   (Monaco / 表格)      │
│ (分组)    │                          │                        │
│          │                          │                        │
├──────────┴──────────────────────────┴────────────────────────┤
│  底栏: [状态: 已连接 redis 7.2] [latency 2ms] [keys: 12345]   │
└─────────────────────────────────────────────────────────────┘
```

- **左侧栏**：连接树（可折叠分组），双击连接进入工作区。
- **中间区**：Key 浏览（主操作区）。
- **右侧区**：选中 Key 的值详情/编辑器。
- **底栏**：连接状态、延迟、Key 总数等实时信息。
- **CLI**：作为可切换的 Tab 或底部抽屉打开。

### 7.2 设计原则

1. **轻量克制**：默认信息密度适中，提供「紧凑模式」。
2. **危险操作显式确认**：删除、FLUSH、大批量操作必须二次确认并展示影响范围。
3. **可逆优先**：删除优先提供回收站/撤销思路（至少强确认）。
4. **键盘友好**：常用操作有快捷键，`Cmd/Ctrl+K` 命令面板。
5. **类型可视化**：每种 Redis 类型有专属图标与最佳视图（Hash→表格，JSON→树）。
6. **暗色优先**：开发工具场景，默认跟随系统主题。

### 7.3 关键交互流程（示例：编辑 Hash 值）

```
选中 Key(hash) → 右侧加载表格 → 双击某 field 的 value
→ 进入编辑(Monaco, JSON 模式) → 保存
→ 后端 HSET key field newValue → 成功 toast + 表格刷新
→ 若 WATCH 检测到并发改动 → 冲突提示, 提供覆盖/放弃
```

---

## 8. 数据模型与状态管理

### 8.1 后端核心结构（示意）

```rust
// 连接配置（持久化）
struct ConnectionConfig {
    id: Uuid,
    name: String,
    host: String,
    port: u16,
    username: Option<String>,       // ACL user
    password_ref: CredentialRef,    // 指向 keyring，不落明文
    db: u8,
    tls: TlsConfig,
    ssh: Option<SshTunnelConfig>,
    timeout_ms: u32,
    group: Option<String>,          // 分组
    created_at: i64,
}

// 运行时连接句柄（内存）
struct ActiveConnection {
    id: Uuid,
    client: fred::Client,           // 或 pool
    server_info: ServerInfo,        // 版本/模式/memory
    mode: RedisMode,                // Standalone | Cluster | Sentinel
}
```

### 8.2 前端状态分层

| 层 | 库 | 内容 |
| --- | --- | --- |
| 服务端数据缓存 | TanStack Query | Key 列表、值、Server Info（带失效与重试） |
| 应用 UI 状态 | Zustand | 当前连接、当前 DB、选中 Key、面板布局、主题 |
| 持久化偏好 | localStorage / Tauri Store | 窗口布局、最近连接、CLI 历史、显示偏好 |

### 8.3 IPC 命令清单（MVP 范围）

| Command | 入参 | 出参 | 说明 |
| --- | --- | --- | --- |
| `list_connections` | — | `Vec<ConnectionConfig>` | 连接列表 |
| `save_connection` | `ConnectionConfig` | `id` | 新增/更新 |
| `test_connection` | `ConnectionConfig` | `ServerInfo` | 测试连通 |
| `connect` | `id` | `ActiveConnectionMeta` | 建立连接 |
| `disconnect` | `id` | `()` | 断开 |
| `dbsize` | `id, db` | `u64` | Key 数量 |
| `scan_keys` | `id, db, cursor, match, count, type` | `{cursor, keys:[KeyBrief]}` | 增量扫描 |
| `get_key_detail` | `id, db, key` | `KeyDetail` | 类型+值（按类型分页） |
| `set_value` | `id, db, key, type, payload` | `()` | 新建/覆盖 |
| `delete_key` | `id, db, keys` | `count` | 删除（带确认在前端） |
| `exec_command` | `id, db, args:Vec<String>` | `CommandResult` | CLI 执行 |

> 推送类事件：`scan_progress`、`batch_progress`、`cli_output`、`pubsub_message`。

---

## 9. 安全设计

| 风险 | 措施 |
| --- | --- |
| 凭据明文落盘 | Password/私钥 passphrase 仅存系统钥匙串（keyring）；配置文件不含明文 |
| 中间人窃听 | 支持 TLS（rustls），默认对非本地连接提示启用 TLS |
| 跳板机访问 | 内置 SSH 隧道（russh）端口转发，私钥 passphrase 走钥匙串 |
| 误删/误清空 | 危险命令白名单二次确认；批量操作显示影响数量、可中断 |
| 大 Key 拖垮 | 值加载分片；`KEYS` 禁用，统一 `SCAN` |
| 日志泄露 | 日志默认脱敏（密码、值截断），可配置等级 |
| 供应链 | 依赖锁定（Cargo.lock），定期 audit（`cargo audit`） |
| 自动更新安全 | 更新包强制签名校验（Tauri Updater signing key） |

---

## 10. 非功能需求

| 维度 | 要求 |
| --- | --- |
| 性能 | 冷启动 < 2s；10w Key 列表首屏 < 500ms；空闲内存 < 120MB；安装包 < 15MB |
| 可靠性 | Redis 异常/网络中断不白屏；自动重连（指数退避，可关闭）；命令超时可配 |
| 跨平台 | Windows 10+ / macOS 11+ (Intel & ARM) / Ubuntu 20.04+ 主流发行版 |
| 可维护性 | 前后端分层清晰；Rust 核心逻辑可独立测试（不依赖 Tauri）；前端组件库化 |
| 可测试性 | Rust 单元测试覆盖核心命令封装；关键 IPC 提供 mock；前端关键流程 E2E(Playwright 可选) |
| 国际化 | 中/英双语，UI 文案外置；时间/数字本地化 |
| 可访问性 | 键盘可达；对比度达 AA；关键控件有 aria 标签 |
| 隐私 | 纯本地，不收集任何遥测（或可选「匿名使用统计」开关，默认关） |

---

## 11. 里程碑与路线图

| 阶段 | 周期(估) | 交付 | 退出标准 |
| --- | --- | --- | --- |
| **M0 脚手架** | 1 周 | Tauri 工程、前后端骨架、IPC 通路、CI | 能从 UI 触发 Rust `ping` 并回显 |
| **M1 连接管理** | 1.5 周 | F-CON（含 TLS/SSH、keyring 加密） | 可保存/连接/断开单机 Redis |
| **M2 Key 浏览** | 1.5 周 | F-KEY（SCAN、搜索、虚拟滚动、TTL） | 10w Key 流畅浏览 |
| **M3 数据编辑** | 2 周 | F-DATA（5 种基本类型查看/编辑） | 5 类型 CRUD 验收通过 |
| **M4 内嵌 CLI** | 1 周 | F-CLI（执行/历史/危险拦截） | CLI 可用且安全拦截生效 |
| **M5 打磨发布** | 1 周 | 三端打包、自动更新、文档、安装包 | **MVP v1.0 发布** |
| **P1 扩展** | 6–8 周 | Cluster、慢日志、INFO、导入导出、大 Key 分析 | v1.x |
| **P2 高级** | 持续 | Sentinel、Redis Stack、监控、插件、主题 | v2.x |

> MVP 总周期约 **7–8 周**（单人全职估算，含联调与测试，不含代码签名流程搭建）。

---

## 12. 风险与应对

| 风险 | 等级 | 应对 |
| --- | --- | --- |
| fred 驱动在 Cluster/模块上的边界 case | 中 | M0 阶段做技术 Spike，覆盖 Standalone；Cluster 留 P1 充分验证 |
| Tauri 2 在某平台 WebView 差异（尤其 Linux WebKitGTK 版本） | 中 | 限定支持发行版与 WebKitGTK 版本；关键 UI 三端回归 |
| 大 Key / 大 Value 导致前端卡顿或 OOM | 高 | 强制分片加载、虚拟滚动、值大小阈值保护、后端裁剪 |
| keyring 在无桌面环境/无 secret service 的 Linux 不可用 | 中 | 降级为本地 AES 加密文件 + 主密码；明确文档说明 |
| 并发编辑覆盖（多端同时改同一 Key） | 中 | 关键类型用 WATCH 或 version 校验；冲突提示 |
| 危险命令误执行 | 高 | 白名单二次确认 + 可配开关 + 审计日志 |
| 自动更新签名密钥泄露 | 高 | 密钥独立保管，CI 单独 job，最小权限 |

---

## 13. 验收标准（MVP DoD）

发布 v1.0 前需全部满足：

1. **功能**：F-CON / F-KEY / F-DATA / F-CLI 全部验收点通过。
2. **性能**：第 1.5 节性能指标全部达标。
3. **安全**：通过安全 checklist（凭据无明文、危险命令拦截、TLS/SSH 可用）。
4. **跨平台**：Windows / macOS / Linux 三端冒烟通过。
5. **稳定**：连续操作 30 分钟无崩溃；断网/重启 Redis 后可自动恢复。
6. **文档**：README、用户指南（连接/浏览/编辑/CLI）、贡献指南齐全。

---

## 14. 附录

### 14.1 Redis 类型支持矩阵（MVP）

| 类型 | 查看 | 新建 | 编辑元素 | 删除 | 备注 |
| --- | :-: | :-: | :-: | :-: | --- |
| String | ✅ | ✅ | ✅(整值) | ✅ | JSON/Hex 视图 |
| Hash | ✅ | ✅ | ✅(HSET/HDEL) | ✅ | 表格 |
| List | ✅ | ✅ | ✅(LSET/LPUSH/RPUSH) | ✅ | 按 index |
| Set | ✅ | ✅ | ✅(SADD/SREM) | ✅ | SSCAN 分页 |
| ZSet | ✅ | ✅ | ✅(ZADD/ZREM) | ✅ | score 排序 |
| Stream | ✅ | ✅(XADD) | ⚠️(只读+追加) | ✅ | XRANGE |

### 14.2 术语表

- **SCAN**：非阻塞增量遍历命令，替代危险的全量 `KEYS`。
- **RESP**：Redis 序列化协议，CLI 回显格式化的依据。
- **fred**：高性能 Rust Redis 客户端，支持 Cluster/模块。
- **Tauri IPC**：Rust 与 WebView 之间的命令调用通道。
- **Keyring**：操作系统级凭据存储服务。

### 14.3 参考

- Tauri 2 官方文档
- fred crate 文档
- Redis 官方命令手册 (redis.io/commands)
- 竞品：RedisInsight / Another Redis Desktop Manager / Medis

---

> **下一步建议**：评审本 PRD → 冻结 MVP 范围 → 进入 M0 脚手架搭建（Tauri 工程初始化、fred Spike、IPC 通路打通）。
