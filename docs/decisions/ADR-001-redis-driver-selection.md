# ADR-001: Redis 驱动选型 (fred vs redis-rs)

| 项目 | 内容 |
| --- | --- |
| 状态 | Accepted |
| 日期 | 2026-06-23 |
| 决策者 | — |
| 关联文档 | [PRD.md](../PRD.md) 第 5.1 节 |

## 背景 (Context)

本项目（Redis GUI 客户端）的长期目标是支持 Redis 的**全部署形态**：
Standalone → Cluster → Sentinel → Redis Stack 模块（见 PRD P0–P2 路线图）。

后端 Rust 层需要一个 Redis 客户端驱动来承载所有命令。这是**不可逆性最高的依赖之一**：
驱动 API 会渗透进 core 层的每一处命令封装，一旦深度耦合，后续更换成本极高。

社区主要有两个候选：

- **fred** (`aembke/fred.rs`) —— 高功能 async 客户端
- **redis-rs** (`redis-rs/redis-rs`) —— 事实标准通用客户端

本 ADR 在事实核实的基础上做选型。

## 事实核实 (2026-06-23, 来源 crates.io API + docs.rs)

| 维度 | **fred** | **redis-rs** |
| --- | --- | --- |
| 最新稳定版 | 10.1.0 | 1.2.4 |
| crates.io 最近发布 | 2025-02-27（约 16 个月前） | 2026-06-19（4 天前） |
| 总下载量 | ~7,022,875 | ~78,599,076 |
| 近期下载量 | ~1,645,787 | ~18,351,676 |
| 维护者 | `aembke`（个人主导） | `redis-rs` 组织（多人，含 Dirkjan Ochtman） |
| 兼容目标 | **Valkey 和 Redis** | Redis（为主） |
| 许可证 | MIT / Apache-2.0 | BSD-3-Clause |

> 注：redis-rs 下载量约为 fred 的 **11 倍**，是事实标准，生态采用度与案例丰富度领先。

## 功能覆盖对比

| 能力 | **fred** | **redis-rs** | 对本项目影响 |
| --- | :---: | :---: | --- |
| Standalone | ✅ | ✅ | MVP 基础，两者皆可 |
| Cluster | ✅ 原生、成熟 | ✅（`cluster-async` feature） | P1 目标 |
| Sentinel | ✅ 原生（`sentinel-client`） | ❌ 无原生（需第三方 `redis-sentinel-pool`） | P2 目标，**fred 优势明显** |
| RESP3 协议 | ✅ | ⚠️ 支持 | 未来兼容 |
| TLS | ✅ rustls / native-tls | ✅ | MVP 安全需求 |
| Unix socket | ✅ | ✅ | 本地连接 |
| 自动重连 | ✅ 多种退避策略 | ⚠️ 有限 | 稳定性关键 |
| Pub/Sub + keyspace events | ✅ | ✅ PubSub | CLI 订阅态 |
| 连接池 | ✅ round-robin / dynamic | 需 bb8 / deadpool 拼装 | 多连接管理 |
| Replica（副本）路由 | ✅ | ❌ | 只读负载分担 |
| Mocking（内置） | ✅ | ❌（需自建） | **测试便利性** |
| Lua 脚本 / 函数 | ✅ | ✅ | CLI/脚本支持 |
| 事务 (MULTI/EXEC) | ✅ | ✅ | 并发编辑乐观锁 |
| Pipelining | ✅ 含**自动 pipelining** | ✅ 手动 | 批量操作性能 |
| Client Tracking (RESP3) | ✅ | ❌ | 缓存失效通知 |
| **Redis Stack 模块** | ✅ RedisJSON / RediSearch / TimeSeries（`i-*` feature） | ❌ 无原生模块接口 | P2 目标，**fred 独有优势** |
| metrics（延迟/包大小） | ✅ 内置 | ❌ | **底栏延迟展示**直接可用 |
| `credential-provider`（动态认证） | ✅ | ❌ | **与 keyring 凭据管理天然契合** |

### API 易用性

| 维度 | **fred** | **redis-rs** |
| --- | --- | --- |
| 引用模型 | 共享引用，`clone` 廉价，易放入 app state | 连接执行需 `&mut`，共享需池化 |
| 命令分发 | 接口 trait，`i-*` feature 可裁剪编译 | 宏 / 命令模式 |
| 响应转换 | 强类型，自动转 Rust 类型 | 需手动 `from_redis_value` |

## 风险对比

### fred 的风险

1. **维护活跃度存疑**：crates.io 显示最近一次发布为 2025-02（10.1.0），距今约 16 个月。虽 10.x 已功能完整，但长期安全/兼容更新的节奏需持续观察。
2. **维护者集中**：主要由个人（aembke）维护，bus factor 较低。
3. **生态/案例较少**：约 1/11 的下载量意味着遇到边界问题时社区参考与第三方集成更少。

### redis-rs 的风险

1. **治理争议**：2024 年底 Redis Inc. 曾提议接管 redis-rs 引发社区与商标争议（见 [issue #1419](https://github.com/redis-rs/redis-rs/issues/1419)）；2025 年由原维护者继续维护并活跃（2026-06 仍在发版），争议已趋缓。
2. **全形态覆盖不足**：**无原生 Sentinel**，**无 Redis Stack 模块接口** —— 这两点正是本项目 P1/P2 的核心目标。若选 redis-rs，Sentinel 与 Stack 要么自行拼装，要么用质量参差的第三方 crate。
3. **凭据注入不友好**：无 `credential-provider` 类抽象，与 keyring 动态取密码的集成需自行包装。

## 决策 (Decision)

**选定 `fred` 作为后端 Redis 驱动。**

### 理由

1. **目标契合度最高**：本项目以「全形态（Cluster + Sentinel + Redis Stack）」为路线。fred 是**唯一一个原生覆盖全部目标**的 Rust 客户端；redis-rs 在 Sentinel 与 Stack 模块上有结构性缺口，补齐成本与不确定性更高。
2. **安全凭据天然契合**：`credential-provider` 接口可直接对接系统钥匙串（keyring），动态注入密码，无需把明文密码常驻内存或塞进连接字符串。
3. **可观测性开箱即用**：内置 `metrics`（延迟、网络延迟、包大小）正好满足 PRD 底栏「实时延迟展示」需求，无需自建采样。
4. **测试友好**：内置 `mocks` 降低 core 层单测成本。
5. **性能**：自动 pipelining、零拷贝帧解析、连接池内建，符合 PRD「10w Key 流畅、低内存」的性能目标。

### 风险对冲（关键）

为缓解 fred「维护活跃度 / bus factor」风险，采取以下**架构隔离**措施，确保未来万一需要切换驱动，影响面可控：

1. **抽象一个 `RedisGateway` trait**（位于 `core/src/gateway.rs`）：
   - 所有上层（scanner / editor / cli / cluster-view）只依赖该 trait，**不直接 import fred 类型**。
   - fred 仅作为该 trait 的一个实现 `FredGateway`。
   - fred 的响应类型在 trait 边界处统一转换为项目内部的领域类型（`KeyBrief` / `ValueView` / `CommandResult`），不外泄。
2. **错误统一封装**：fred 的 `Error` 在 gateway 边界转为项目 `AppError`，上层不感知驱动错误类型。
3. **连接配置中立**：`ConnectionConfig`（见 PRD 8.1）不绑定任何驱动类型，可在 trait 实现间复用。
4. **M0 阶段 Spike**：在搭建脚手架时，用 fred 跑通以下关键路径作为验收门槛，不通过则重新评估：
   - TLS + SSH 隧道叠加连接；
   - 大 Key `SCAN` 增量分页（10w+）；
   - 5 种基本类型 CRUD；
   - 断网/重启 Redis 后自动重连。
5. **持续监控 fred 维护状态**：若连续 ≥12 个月无任何版本/安全更新，重新启动本 ADR 评估迁移可行性（因有 trait 隔离，迁移成本可控）。

## 后果 (Consequences)

### 正面

- Sentinel 与 Redis Stack 模块无需自研或拼装第三方。
- 凭据、监控、mock 能力直接可用，减少基础设施代码量。
- API 人体工学好（共享引用），多连接/连接池管理简单。

### 负面 / 成本

- 需**额外投入**设计并维护 `RedisGateway` trait 抽象层（一次性，约 1–2 天）。
- 上层代码需养成「只依赖 trait、不依赖 fred 具体类型」的纪律，需在 code review 中把关。
- 团队需熟悉 fred 的 `i-*` feature 编译裁剪机制（仅启用所需接口，降低编译时间）。
- 需接受「驱动用户基数小、社区案例少」的现实，遇到问题时更依赖官方文档与源码。

## 编译特性建议（Cargo features）

启用以下 fred features（按 MVP 范围，P1/P2 再增量）：

```toml
[dependencies.fred]
version = "10.1"
default-features = false
features = [
  "i-all",                # 全命令接口（GUI 需要覆盖面，编译时间可接受）
  "enable-rustls-ring",   # TLS via rustls + ring（纯 Rust，跨平台）
  "i-cluster",            # Cluster 命令（P1）
  "i-slowlog",            # 慢日志（P1）
  "subscriber-client",    # Pub/Sub 订阅（CLI 订阅态）
  "metrics",              # 延迟/包大小（底栏展示）
  "credential-provider",  # 对接 keyring
  "serde-json",           # JSON 值转换
  "replicas",             # 副本路由（P2 只读负载）
]
# P2 增补: "i-redis-stack"（RedisJSON/RediSearch/TimeSeries）
```

> `i-all` 会带来较大编译面；如 M0 发现编译过慢，可退化为按需 `i-std` + 具体接口。

## 替代方案 (Alternatives Considered)

1. **redis-rs + 第三方 sentinel/stack crate**：被否决。Sentinel/Stack 第三方 crate 质量、维护参差，且 redis-rs 无 `credential-provider`，与安全设计耦合差。
2. **同时封装两者（双实现）**：被否决。维护两套实现成本高、收益低；`RedisGateway` trait 已为未来单方向迁移留好口子，无需现在就做双实现。
3. **redis-async / 其他小众客户端**：被否决。生态更小，无明显优势。

## 参考

- fred docs.rs：<https://docs.rs/fred>
- fred 仓库：<https://github.com/aembke/fred.rs>
- redis-rs：<https://github.com/redis-rs/redis-rs>
- redis-rs 治理讨论：<https://github.com/redis-rs/redis-rs/issues/1419>

---

> 本 ADR 与 [PRD.md](../PRD.md) 配套。驱动相关的所有实现细节须以本文档的「风险对冲」与「编译特性建议」为准。
