# 贡献指南 / Contributing

感谢你对 Redis Client 的兴趣！本文说明如何搭建开发环境与提交贡献。

## 开发环境

依赖：

- **Rust** ≥ 1.77（`rustup`）
- **Node.js** ≥ 20（含 npm）
- **Redis**（仅集成测试需要）：`brew install redis && brew services start redis`
- Linux 还需 Tauri 系统库：`libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf`

启动开发模式（前端热重载 + Rust 后端）：

```sh
npm install
npm run tauri dev
```

## 代码规范（CI 强制）

提交前请确保以下全部通过（CI 会跑同样检查）：

```sh
cargo fmt --all -- --check          # Rust 格式
cargo clippy --workspace --all-targets -- -D warnings   # 无警告
cargo test -p redis-core --lib      # 单测
npm run build                       # tsc 严格类型检查 + vite 构建
```

- 前端为 TypeScript **严格模式**（`noUnusedLocals` 等）：勿留未用 import / 变量。
- Rust 侧遵循已有风格；改动后跑 `cargo fmt` 自动格式化。

## 架构约束（重要）

上层（`src-tauri` 命令层 + 前端）**只依赖 `RedisGateway` trait，绝不直接 import fred 类型**。
fred 仅活在 `crates/redis-core/src/fred_gateway.rs` 一个文件里（见 [ADR-001](docs/decisions/ADR-001-redis-driver-selection.md)）。
新增 Redis 能力时：先在 `gateway.rs` trait 加方法 → 在 `fred_gateway.rs` 实现 → 在 `main.rs` 暴露 Tauri 命令 → 前端 `lib/ipc.ts` 加类型化封装。勿绕过此分层。

## 凭据安全红线

- 密码 **绝不** 明文落盘、**绝不** 出现在 IPC 响应（`ConnectionConfig.password` 带 `#[serde(skip_serializing)]`，由单测守护）。
- SSH 密码 / 私钥 passphrase 加密存于 `passwords.enc` 的前缀键 `ssh:pass::` / `ssh:keypass::`。
- 任何涉及凭据的改动请补/更新对应单测。

## 提交 Pull Request

1. Fork → 新建分支（`feat/...` / `fix/...`）。
2. 保证上述四项检查全绿。
3. PR 描述写清动机与改动范围；涉及行为变更附截图/GIF。
4. 危险操作（删除命名空间、批量 TTL、`FLUSHALL` 等）必须有二次确认。

## 行为准则

请保持友善、尊重。欢迎新人提问；维护者会尽力及时回复。
