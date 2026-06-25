//! fred 驱动对 [`RedisGateway`] 的实现。
//!
//! **这是整个项目唯一的 fred 耦合点**（ADR-001 风险对冲关键）。
//! 上层只依赖 `RedisGateway` trait；若未来更换驱动，影响面仅限本文件。

use async_trait::async_trait;
use fred::bytes_utils::Str;
use fred::cmd;
use fred::prelude::*;
use fred::types::scan::ScanType;
use fred::types::{ClusterHash, CustomCommand};
use fred::types::config::ReconnectPolicy;
use tracing::debug;

use crate::error::AppError;
use crate::gateway::{RedisGateway, ScanCursor, ScanPage};
use crate::types::{
    HashField, KeyBrief, KeyDetail, KeyMemStat, ListSide, MemAnalysis, PagePos, PatternStats,
    PendingEntry, RedisType, ServerInfo, ServerStats, SlowEntry, StreamEntry, StreamGroupInfo,
    ValuePage, ValueView, WriteOp, ZSetMember,
};

/// 连接配置（领域中立，不暴露 fred 类型）。
#[derive(Debug, Clone)]
pub struct FredConnectConfig {
    pub url: String,
    /// 连接超时（秒）
    pub timeout_secs: u64,
}

impl FredConnectConfig {
    /// 便捷构造：`redis://[password@]host:port/db`。
    pub fn new(host: &str, port: u16, password: Option<&str>, db: u8) -> Self {
        let url = match password {
            Some(p) if !p.is_empty() => format!("redis://:{}@{}:{}/{}", p, host, port, db),
            _ => format!("redis://{}:{}/{}", host, port, db),
        };
        Self {
            url,
            timeout_secs: 5,
        }
    }
}

/// fred 实现的网关。
pub struct FredGateway {
    client: Client,
}

impl FredGateway {
    /// 建立连接。fred 依据 URL scheme 自动识别 standalone / cluster / TLS / sentinel。
    /// 配置指数退避重连策略：掉线后自动重连（500ms 起、30s 封顶、无限次），
    /// 命令在重连成功后会被重试——上层命令因此具备「自愈」能力。
    pub async fn connect(cfg: FredConnectConfig) -> Result<Self, AppError> {
        let config = Config::from_url(&cfg.url).map_err(AppError::from_display)?;
        let client = Builder::from_config(config)
            .with_connection_config(|c| {
                c.connection_timeout = std::time::Duration::from_secs(cfg.timeout_secs);
            })
            .set_policy(ReconnectPolicy::new_exponential(u32::MAX, 500, 30_000, 2))
            .build()
            .map_err(AppError::from_display)?;
        client.init().await.map_err(AppError::from_display)?;
        debug!("fred 连接成功（凭据已脱敏）");
        Ok(Self { client })
    }

    /// 暴露内部 client，仅供 Spike / 测试使用（上层业务不应调用）。
    #[doc(hidden)]
    pub fn client(&self) -> &Client {
        &self.client
    }
}

#[async_trait]
impl RedisGateway for FredGateway {
    async fn ping(&self) -> Result<ServerInfo, AppError> {
        // INFO 一次拿连通 + version + 模式
        let info: String = self
            .client
            .info(None)
            .await
            .map_err(AppError::from_display)?;
        Ok(ServerInfo {
            reachable: true,
            version: parse_info(&info, "redis_version"),
            mode: parse_info(&info, "redis_mode").or_else(|| parse_info(&info, "role")),
        })
    }

    async fn dbsize(&self) -> Result<u64, AppError> {
        let n: u64 = self.client.dbsize().await.map_err(AppError::from_display)?;
        Ok(n)
    }

    async fn select_db(&self, db: u8) -> Result<(), AppError> {
        self.client.select(db as i64).await.map_err(|e| {
            let msg = e.to_string();
            if msg.to_lowercase().contains("cluster") {
                AppError::Unsupported("集群模式不支持切换 DB".into())
            } else {
                AppError::from_display(msg)
            }
        })
    }

    async fn scan(
        &self,
        cursor: ScanCursor,
        pattern: Option<&str>,
        type_filter: Option<RedisType>,
        count: u64,
    ) -> Result<ScanPage, AppError> {
        let scan_ty = type_filter.and_then(map_scan_type);
        let cur: Str = cursor.0.to_string().into();
        let (next, keys): (Str, Vec<Str>) = self
            .client
            .scan_page(cur, pattern.unwrap_or("*"), Some(count as u32), scan_ty)
            .await
            .map_err(AppError::from_display)?;
        // Str: Deref<Target=str>，直接 parse（as_str 在 stable 上是 unstable）
        let next_n: u64 = next.parse().unwrap_or(0);

        if keys.is_empty() {
            return Ok(ScanPage {
                next_cursor: ScanCursor(next_n),
                keys: Vec::new(),
            });
        }

        // 一条 pipeline 批量取整页的 TYPE + PTTL（1 次往返，替代逐 key 的 N+1）
        let owned: Vec<String> = keys.iter().map(|k| k.to_string()).collect();
        let pipe = self.client.pipeline();
        for k in &owned {
            let _: () = pipe
                .r#type(k.as_str())
                .await
                .map_err(AppError::from_display)?;
            let _: () = pipe
                .pttl(k.as_str())
                .await
                .map_err(AppError::from_display)?;
        }
        let res: Vec<Value> = pipe.all().await.map_err(AppError::from_display)?;

        let mut briefs = Vec::with_capacity(owned.len());
        for (i, key) in owned.iter().enumerate() {
            let ty_str = res
                .get(2 * i)
                .and_then(|v| v.clone().convert::<String>().ok())
                .unwrap_or_else(|| "unknown".to_string());
            let ty = RedisType::from(ty_str.as_str());
            if ty == RedisType::None {
                continue; // 扫描期间被删除
            }
            let pttl = res
                .get(2 * i + 1)
                .and_then(|v| v.clone().convert::<i64>().ok())
                .unwrap_or(-1);
            briefs.push(KeyBrief {
                key: key.clone(),
                ty,
                ttl: pttl_to_ttl(pttl),
            });
        }
        Ok(ScanPage {
            next_cursor: ScanCursor(next_n),
            keys: briefs,
        })
    }

    async fn key_type(&self, key: &str) -> Result<Option<RedisType>, AppError> {
        // 用 custom 发 TYPE，返回类型名字符串
        let ty: String = self
            .client
            .custom(cmd!("TYPE"), vec![key])
            .await
            .map_err(AppError::from_display)?;
        let rt = RedisType::from(ty.as_str());
        Ok(if rt == RedisType::None {
            None
        } else {
            Some(rt)
        })
    }

    async fn read_value(&self, key: &str, ty: RedisType) -> Result<ValueView, AppError> {
        match ty {
            RedisType::String => {
                let v: Option<String> =
                    self.client.get(key).await.map_err(AppError::from_display)?;
                let value = v.unwrap_or_default();
                let is_json = serde_json::from_str::<serde_json::Value>(&value).is_ok();
                Ok(ValueView::String { value, is_json })
            }
            RedisType::Hash => {
                let map: std::collections::HashMap<String, String> = self
                    .client
                    .hgetall(key)
                    .await
                    .map_err(AppError::from_display)?;
                let fields = map
                    .into_iter()
                    .map(|(field, value)| HashField { field, value })
                    .collect();
                Ok(ValueView::Hash { fields })
            }
            RedisType::List => {
                let items: Vec<String> = self
                    .client
                    .lrange(key, 0, -1)
                    .await
                    .map_err(AppError::from_display)?;
                Ok(ValueView::List { items })
            }
            RedisType::Set => {
                let members: Vec<String> = self
                    .client
                    .smembers(key)
                    .await
                    .map_err(AppError::from_display)?;
                Ok(ValueView::Set { members })
            }
            RedisType::ZSet => {
                // zrange withscores → Vec<(member, score)>，升序
                let pairs: Vec<(String, f64)> = self
                    .client
                    .zrange(key, 0i64, -1i64, None, false, None, true)
                    .await
                    .map_err(AppError::from_display)?;
                let members = pairs
                    .into_iter()
                    .map(|(member, score)| ZSetMember { member, score })
                    .collect();
                Ok(ValueView::ZSet { members })
            }
            RedisType::Stream => {
                // xrange_values → Vec<(id, HashMap<field, value>)>
                let entries: Vec<(String, std::collections::HashMap<String, String>)> = self
                    .client
                    .xrange_values(key, "-", "+", None)
                    .await
                    .map_err(AppError::from_display)?;
                let entries = entries
                    .into_iter()
                    .map(|(id, fields)| StreamEntry {
                        id,
                        fields: fields
                            .into_iter()
                            .map(|(field, value)| HashField { field, value })
                            .collect(),
                    })
                    .collect();
                Ok(ValueView::Stream { entries })
            }
            _ => Err(AppError::Unsupported(format!("不支持读取类型 {:?}", ty))),
        }
    }

    async fn key_detail(&self, key: &str) -> Result<KeyDetail, AppError> {
        // 一条 pipeline 取 TYPE + PTTL（与 scan 同款），再按类型取值。
        let pipe = self.client.pipeline();
        let _: () = pipe.r#type(key).await.map_err(AppError::from_display)?;
        let _: () = pipe.pttl(key).await.map_err(AppError::from_display)?;
        let res: Vec<Value> = pipe.all().await.map_err(AppError::from_display)?;

        let ty_str = res
            .first()
            .and_then(|v| v.clone().convert::<String>().ok())
            .unwrap_or_else(|| "unknown".to_string());
        let ty = RedisType::from(ty_str.as_str());
        let pttl = res
            .get(1)
            .and_then(|v| v.clone().convert::<i64>().ok())
            .unwrap_or(-1);

        // key 不存在：占位，无分页。
        if ty == RedisType::None {
            return Ok(KeyDetail {
                key: key.to_string(),
                ty,
                ttl: pttl_to_ttl(pttl),
                total: None,
                next_pos: None,
                value: ValueView::Unknown { raw: String::new() },
            });
        }
        // string/unknown：全量；集合：总数 + 首页（分页取，避免大集合全量拉取）。
        let (value, total, next_pos) = match ty {
            RedisType::String | RedisType::Unknown => (self.read_value(key, ty).await?, None, None),
            _ => {
                let total = self.collection_count(key, ty).await?;
                let page = self
                    .read_value_page(key, ty, start_pos(ty), VALUE_PAGE)
                    .await?;
                (page.value, Some(total), page.next)
            }
        };
        Ok(KeyDetail {
            key: key.to_string(),
            ty,
            ttl: pttl_to_ttl(pttl),
            total,
            next_pos,
            value,
        })
    }

    async fn collection_count(&self, key: &str, ty: RedisType) -> Result<u64, AppError> {
        let n: u64 = match ty {
            RedisType::List => self.client.llen(key).await,
            RedisType::Hash => self.client.hlen(key).await,
            RedisType::Set => self.client.scard(key).await,
            RedisType::ZSet => self.client.zcard(key).await,
            RedisType::Stream => self.client.xlen(key).await,
            _ => return Ok(0),
        }
        .map_err(AppError::from_display)?;
        Ok(n)
    }

    async fn read_value_page(
        &self,
        key: &str,
        ty: RedisType,
        pos: PagePos,
        limit: u64,
    ) -> Result<ValuePage, AppError> {
        let lim = limit.max(1) as i64;
        match (ty, pos) {
            (RedisType::List, PagePos::Offset { offset }) => {
                let start = offset as i64;
                let items: Vec<String> = self
                    .client
                    .lrange(key, start, start + lim - 1)
                    .await
                    .map_err(AppError::from_display)?;
                let next = next_offset(offset, items.len(), limit);
                Ok(ValuePage {
                    value: ValueView::List { items },
                    next,
                })
            }
            (RedisType::ZSet, PagePos::Offset { offset }) => {
                let start = offset as i64;
                let pairs: Vec<(String, f64)> = self
                    .client
                    .zrange(key, start, start + lim - 1, None, false, None, true)
                    .await
                    .map_err(AppError::from_display)?;
                let members: Vec<ZSetMember> = pairs
                    .into_iter()
                    .map(|(member, score)| ZSetMember { member, score })
                    .collect();
                let next = next_offset(offset, members.len(), limit);
                Ok(ValuePage {
                    value: ValueView::ZSet { members },
                    next,
                })
            }
            (RedisType::Stream, PagePos::AfterId { id }) => {
                let entries: Vec<(String, std::collections::HashMap<String, String>)> = self
                    .client
                    .xrange_values(key, id.as_str(), "+", Some(limit))
                    .await
                    .map_err(AppError::from_display)?;
                let last_id = entries.last().map(|(id, _)| id.clone());
                let entries = entries
                    .into_iter()
                    .map(|(id, fields)| StreamEntry {
                        id,
                        fields: fields
                            .into_iter()
                            .map(|(field, value)| HashField { field, value })
                            .collect(),
                    })
                    .collect::<Vec<_>>();
                let full = entries.len() as u64 >= limit;
                let next = if full {
                    last_id.map(|lid| PagePos::AfterId {
                        id: format!("({lid}"),
                    })
                } else {
                    None
                };
                Ok(ValuePage {
                    value: ValueView::Stream { entries },
                    next,
                })
            }
            (RedisType::Hash, PagePos::Cursor { cursor }) => {
                let (next_cursor, flat) = self.raw_scan(key, "HSCAN", cursor, limit).await?;
                let mut fields = Vec::with_capacity(flat.len() / 2);
                let mut i = 0;
                while i + 1 < flat.len() {
                    fields.push(HashField {
                        field: flat[i].clone(),
                        value: flat[i + 1].clone(),
                    });
                    i += 2;
                }
                let next = if next_cursor == 0 {
                    None
                } else {
                    Some(PagePos::Cursor {
                        cursor: next_cursor,
                    })
                };
                Ok(ValuePage {
                    value: ValueView::Hash { fields },
                    next,
                })
            }
            (RedisType::Set, PagePos::Cursor { cursor }) => {
                let (next_cursor, members) = self.raw_scan(key, "SSCAN", cursor, limit).await?;
                let next = if next_cursor == 0 {
                    None
                } else {
                    Some(PagePos::Cursor {
                        cursor: next_cursor,
                    })
                };
                Ok(ValuePage {
                    value: ValueView::Set { members },
                    next,
                })
            }
            _ => Err(AppError::Unsupported("该类型/位置不支持分页读取".into())),
        }
    }

    async fn exec_raw(&self, args: &[String]) -> Result<String, AppError> {
        if args.is_empty() {
            return Err(AppError::Unsupported("空命令".into()));
        }
        // 动态命令名 → CustomCommand::new（cmd! 宏面向静态命令名）
        let cmd = CustomCommand::new(args[0].to_uppercase(), ClusterHash::Random, false);
        let rest: Vec<&str> = args[1..].iter().map(|s| s.as_str()).collect();
        let val: Value = self
            .client
            .custom(cmd, rest)
            .await
            .map_err(AppError::from_display)?;
        Ok(value_to_readable(&val))
    }

    async fn del(&self, key: &str) -> Result<bool, AppError> {
        let n: u64 = self.client.del(key).await.map_err(AppError::from_display)?;
        Ok(n > 0)
    }

    async fn write(&self, key: &str, op: WriteOp) -> Result<(), AppError> {
        match op {
            WriteOp::SetString { value } => {
                let _: () = self
                    .client
                    .set(key, value, None, None, false)
                    .await
                    .map_err(AppError::from_display)?;
            }
            WriteOp::HashSet { field, value } => {
                let map = std::collections::HashMap::from([(field, value)]);
                let _: () = self
                    .client
                    .hset(key, map)
                    .await
                    .map_err(AppError::from_display)?;
            }
            WriteOp::HashDel { field } => {
                let _: u64 = self
                    .client
                    .hdel(key, field)
                    .await
                    .map_err(AppError::from_display)?;
            }
            WriteOp::ListPush { side, value } => match side {
                ListSide::Left => {
                    let _: u64 = self
                        .client
                        .lpush(key, value)
                        .await
                        .map_err(AppError::from_display)?;
                }
                ListSide::Right => {
                    let _: u64 = self
                        .client
                        .rpush(key, value)
                        .await
                        .map_err(AppError::from_display)?;
                }
            },
            WriteOp::ListSet { index, value } => {
                let _: () = self
                    .client
                    .lset(key, index, value)
                    .await
                    .map_err(AppError::from_display)?;
            }
            WriteOp::ListRemove { count, value } => {
                let _: u64 = self
                    .client
                    .lrem(key, count, value)
                    .await
                    .map_err(AppError::from_display)?;
            }
            WriteOp::SetAdd { member } => {
                let _: u64 = self
                    .client
                    .sadd(key, member)
                    .await
                    .map_err(AppError::from_display)?;
            }
            WriteOp::SetRemove { member } => {
                let _: u64 = self
                    .client
                    .srem(key, member)
                    .await
                    .map_err(AppError::from_display)?;
            }
            WriteOp::ZSetAdd { member, score } => {
                let _: u64 = self
                    .client
                    .zadd(key, None, None, false, false, (score, member))
                    .await
                    .map_err(AppError::from_display)?;
            }
            WriteOp::ZSetRemove { member } => {
                let _: u64 = self
                    .client
                    .zrem(key, member)
                    .await
                    .map_err(AppError::from_display)?;
            }
        }
        Ok(())
    }

    async fn set_ttl(&self, key: &str, ttl: Option<i64>) -> Result<(), AppError> {
        match ttl {
            Some(secs) => {
                let _: u64 = self
                    .client
                    .expire(key, secs, None)
                    .await
                    .map_err(AppError::from_display)?;
            }
            None => {
                let _: bool = self
                    .client
                    .persist(key)
                    .await
                    .map_err(AppError::from_display)?;
            }
        }
        Ok(())
    }

    async fn memory_usage(&self, key: &str) -> Result<Option<u64>, AppError> {
        // MEMORY USAGE：缺失 key 返回 nil → Option<i64> 为 None。
        let bytes: Option<i64> = self
            .client
            .memory_usage(key, None)
            .await
            .map_err(AppError::from_display)?;
        Ok(bytes.and_then(|n| if n < 0 { None } else { Some(n as u64) }))
    }

    async fn pattern_stats(&self, pattern: &str) -> Result<PatternStats, AppError> {
        // 游标循环扫描全匹配 key，逐页 pipeline 取 MEMORY USAGE 求和（不一次性持有所有 key）。
        let mut count: u64 = 0;
        let mut bytes: u64 = 0;
        let mut cursor: Str = "0".to_string().into();
        loop {
            let (next, keys): (Str, Vec<Str>) = self
                .client
                .scan_page(cursor, pattern, Some(200), None)
                .await
                .map_err(AppError::from_display)?;
            cursor = next;
            if !keys.is_empty() {
                let owned: Vec<String> = keys.iter().map(|k| k.to_string()).collect();
                let pipe = self.client.pipeline();
                for k in &owned {
                    let _: () = pipe
                        .memory_usage(k.as_str(), None)
                        .await
                        .map_err(AppError::from_display)?;
                }
                let res: Vec<Value> = pipe.all().await.map_err(AppError::from_display)?;
                count += owned.len() as u64;
                for v in &res {
                    bytes += v.clone().convert::<i64>().unwrap_or(0).max(0) as u64;
                }
            }
            if cursor.parse::<u64>().unwrap_or(0) == 0 {
                break;
            }
        }
        Ok(PatternStats { count, bytes })
    }

    async fn delete_by_pattern(&self, pattern: &str) -> Result<u64, AppError> {
        // 游标循环扫描全匹配 key，逐页 UNLINK（非阻塞删除），累加删除数。
        let mut deleted: u64 = 0;
        let mut cursor: Str = "0".to_string().into();
        loop {
            let (next, keys): (Str, Vec<Str>) = self
                .client
                .scan_page(cursor, pattern, Some(200), None)
                .await
                .map_err(AppError::from_display)?;
            cursor = next;
            if !keys.is_empty() {
                let owned: Vec<String> = keys.iter().map(|k| k.to_string()).collect();
                let n: u64 = self
                    .client
                    .unlink(owned)
                    .await
                    .map_err(AppError::from_display)?;
                deleted += n;
            }
            if cursor.parse::<u64>().unwrap_or(0) == 0 {
                break;
            }
        }
        Ok(deleted)
    }

    async fn rename_key(&self, src: &str, dst: &str) -> Result<(), AppError> {
        let _: () = self
            .client
            .rename(src, dst)
            .await
            .map_err(AppError::from_display)?;
        Ok(())
    }

    async fn copy_key(&self, src: &str, dst: &str, replace: bool) -> Result<bool, AppError> {
        let n: u64 = self
            .client
            .copy(src, dst, None, replace)
            .await
            .map_err(AppError::from_display)?;
        Ok(n > 0)
    }

    async fn set_ttl_by_pattern(&self, pattern: &str, ttl: Option<i64>) -> Result<u64, AppError> {
        // 游标循环扫描全匹配 key，逐页 pipeline 批量 EXPIRE/PERSIST，累加处理数。
        let mut count: u64 = 0;
        let mut cursor: Str = "0".to_string().into();
        loop {
            let (next, keys): (Str, Vec<Str>) = self
                .client
                .scan_page(cursor, pattern, Some(200), None)
                .await
                .map_err(AppError::from_display)?;
            cursor = next;
            if !keys.is_empty() {
                let owned: Vec<String> = keys.iter().map(|k| k.to_string()).collect();
                let pipe = self.client.pipeline();
                for k in &owned {
                    match ttl {
                        Some(secs) => {
                            let _: () = pipe
                                .expire(k.as_str(), secs, None)
                                .await
                                .map_err(AppError::from_display)?;
                        }
                        None => {
                            let _: () = pipe
                                .persist(k.as_str())
                                .await
                                .map_err(AppError::from_display)?;
                        }
                    }
                }
                let _: Vec<Value> = pipe.all().await.map_err(AppError::from_display)?;
                count += owned.len() as u64;
            }
            if cursor.parse::<u64>().unwrap_or(0) == 0 {
                break;
            }
        }
        Ok(count)
    }

    async fn analyze_memory(&self, limit: usize) -> Result<MemAnalysis, AppError> {
        // 扫描当前 db 全部 key，每页 pipeline 取 TYPE + PTTL + MEMORY USAGE。
        // top-N 用有界缓冲（超 limit*4 时排序裁剪到 limit*2）防 OOM；total_keys/total_bytes 全量累计。
        let mut scanned: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut top: Vec<KeyMemStat> = Vec::new();
        let mut cursor: Str = "0".to_string().into();
        loop {
            let (next, keys): (Str, Vec<Str>) = self
                .client
                .scan_page(cursor, "*", Some(200), None)
                .await
                .map_err(AppError::from_display)?;
            cursor = next;
            if !keys.is_empty() {
                let owned: Vec<String> = keys.iter().map(|k| k.to_string()).collect();
                let pipe = self.client.pipeline();
                for k in &owned {
                    let _: () = pipe
                        .r#type(k.as_str())
                        .await
                        .map_err(AppError::from_display)?;
                    let _: () = pipe
                        .pttl(k.as_str())
                        .await
                        .map_err(AppError::from_display)?;
                    let _: () = pipe
                        .memory_usage(k.as_str(), None)
                        .await
                        .map_err(AppError::from_display)?;
                }
                let res: Vec<Value> = pipe.all().await.map_err(AppError::from_display)?;
                for (i, key) in owned.iter().enumerate() {
                    let ty_str = res
                        .get(3 * i)
                        .and_then(|v| v.clone().convert::<String>().ok())
                        .unwrap_or_else(|| "unknown".to_string());
                    let ty = RedisType::from(ty_str.as_str());
                    if ty == RedisType::None {
                        continue; // 扫描期间被删
                    }
                    let pttl = res
                        .get(3 * i + 1)
                        .and_then(|v| v.clone().convert::<i64>().ok())
                        .unwrap_or(-1);
                    let bytes = res
                        .get(3 * i + 2)
                        .and_then(|v| v.clone().convert::<i64>().ok())
                        .unwrap_or(0)
                        .max(0) as u64;
                    scanned += 1;
                    total_bytes += bytes;
                    top.push(KeyMemStat {
                        key: key.clone(),
                        ty,
                        ttl: pttl_to_ttl(pttl),
                        bytes,
                    });
                }
                // 有界缓冲：超阈值时排序裁剪，防止超大库 OOM。
                if top.len() > limit * 4 {
                    top.sort_by_key(|b| std::cmp::Reverse(b.bytes));
                    top.truncate(limit * 2);
                }
            }
            if cursor.parse::<u64>().unwrap_or(0) == 0 {
                break;
            }
        }
        top.sort_by_key(|b| std::cmp::Reverse(b.bytes));
        top.truncate(limit.max(1));
        Ok(MemAnalysis {
            total_keys: scanned,
            total_bytes,
            top,
        })
    }

    async fn server_stats(&self) -> Result<ServerStats, AppError> {
        // 一次 INFO 拿全部统计字段（解析为数字）。
        let info: String = self
            .client
            .info(None)
            .await
            .map_err(AppError::from_display)?;
        Ok(ServerStats {
            used_memory_bytes: parse_info_u64(&info, "used_memory"),
            used_memory_peak_bytes: parse_info_u64(&info, "used_memory_peak"),
            connected_clients: parse_info_u64(&info, "connected_clients"),
            ops_per_sec: parse_info_u64(&info, "instantaneous_ops_per_sec"),
            keyspace_hits: parse_info_u64(&info, "keyspace_hits"),
            keyspace_misses: parse_info_u64(&info, "keyspace_misses"),
            uptime_secs: parse_info_u64(&info, "uptime_in_seconds"),
            total_commands: parse_info_u64(&info, "total_commands_processed"),
            db_key_counts: parse_keyspace(&info),
        })
    }

    async fn slowlog(&self, limit: i64) -> Result<Vec<SlowEntry>, AppError> {
        // SLOWLOG GET：每条是 [id, ts, duration_us, args[], client_addr, client_name]。
        let entries: Vec<Value> = self
            .client
            .slowlog_get(Some(limit))
            .await
            .map_err(AppError::from_display)?;
        let mut out = Vec::with_capacity(entries.len());
        for e in entries {
            let arr = match e {
                Value::Array(a) => a,
                _ => continue,
            };
            let id = arr
                .first()
                .and_then(|v| v.clone().convert::<i64>().ok())
                .unwrap_or(0);
            let ts = arr
                .get(1)
                .and_then(|v| v.clone().convert::<i64>().ok())
                .unwrap_or(0);
            let dur = arr
                .get(2)
                .and_then(|v| v.clone().convert::<i64>().ok())
                .unwrap_or(0);
            let cmd = arr
                .get(3)
                .and_then(|v| v.clone().convert::<Vec<String>>().ok())
                .map(|p| p.join(" "))
                .unwrap_or_default();
            let client = arr
                .get(4)
                .and_then(|v| v.clone().convert::<String>().ok())
                .unwrap_or_default();
            out.push(SlowEntry {
                id,
                timestamp_secs: ts,
                duration_us: dur,
                command: cmd,
                client,
            });
        }
        Ok(out)
    }

    async fn publish(&self, channel: &str, message: &str) -> Result<i64, AppError> {
        let n: i64 = self
            .client
            .publish(channel, message)
            .await
            .map_err(AppError::from_display)?;
        Ok(n)
    }

    async fn stream_groups(&self, key: &str) -> Result<Vec<StreamGroupInfo>, AppError> {
        let val: Value = self
            .client
            .xinfo_groups(key)
            .await
            .map_err(AppError::from_display)?;
        // XINFO GROUPS → [[group], ...]；每组 RESP2 交替数组 / RESP3 map。
        // into_array() 对两者都摊平为 [k, v, k, v, ...]，统一处理。
        let mut out = Vec::new();
        for group in val.into_array() {
            let kv = group.into_array();
            let mut name = String::new();
            let mut consumers = 0u64;
            let mut pending = 0u64;
            let mut lag: Option<i64> = None;
            let mut last_delivered_id = String::new();
            let mut i = 0;
            while i + 1 < kv.len() {
                let k = kv[i].as_string().unwrap_or_default().to_lowercase();
                let v = kv[i + 1].clone();
                match k.as_str() {
                    "name" => name = v.as_string().unwrap_or_default(),
                    "consumers" => consumers = v.convert::<i64>().unwrap_or(0).max(0) as u64,
                    "pending" => pending = v.convert::<i64>().unwrap_or(0).max(0) as u64,
                    "lag" => lag = v.convert::<i64>().ok(),
                    "last-delivered-id" => last_delivered_id = v.as_string().unwrap_or_default(),
                    _ => {}
                }
                i += 2;
            }
            out.push(StreamGroupInfo {
                name,
                consumers,
                pending,
                lag,
                last_delivered_id,
            });
        }
        Ok(out)
    }

    async fn stream_create_group(
        &self,
        key: &str,
        group: &str,
        id: &str,
        mkstream: bool,
    ) -> Result<(), AppError> {
        let _: Value = self
            .client
            .xgroup_create(key, group, id, mkstream)
            .await
            .map_err(AppError::from_display)?;
        Ok(())
    }

    async fn stream_destroy_group(&self, key: &str, group: &str) -> Result<(), AppError> {
        let _: Value = self
            .client
            .xgroup_destroy(key, group)
            .await
            .map_err(AppError::from_display)?;
        Ok(())
    }

    async fn stream_ack(&self, key: &str, group: &str, ids: &[String]) -> Result<u64, AppError> {
        let n: i64 = self
            .client
            .xack(key, group, ids.to_vec())
            .await
            .map_err(AppError::from_display)?;
        Ok(n.max(0) as u64)
    }

    async fn stream_pending(
        &self,
        key: &str,
        group: &str,
        count: u64,
    ) -> Result<Vec<PendingEntry>, AppError> {
        // 详式 XPENDING（带 start/end/count）→ [[id, consumer, idle, deliveries], ...]
        let val: Value = self
            .client
            .xpending(key, group, ("-", "+", count))
            .await
            .map_err(AppError::from_display)?;
        let mut out = Vec::new();
        for entry in val.into_array() {
            let a = entry.into_array();
            if a.len() < 4 {
                continue;
            }
            out.push(PendingEntry {
                id: a[0].as_string().unwrap_or_default(),
                consumer: a[1].as_string().unwrap_or_default(),
                idle_ms: a[2].clone().convert::<i64>().unwrap_or(0).max(0) as u64,
                deliveries: a[3].clone().convert::<i64>().unwrap_or(0).max(0) as u64,
            });
        }
        Ok(out)
    }
}

impl FredGateway {
    /// 原始 HSCAN/SSCAN（自行控制游标以支持翻页）：返回 (下一游标, 扁平成员串)。
    /// HSCAN 为 [field,value,...] 交替；SSCAN 为 [member,...]。
    async fn raw_scan(
        &self,
        key: &str,
        cmd_name: &str,
        cursor: u64,
        limit: u64,
    ) -> Result<(u64, Vec<String>), AppError> {
        let cursor_s = cursor.to_string();
        let limit_s = limit.to_string();
        let cmd = CustomCommand::new(cmd_name.to_string(), ClusterHash::Random, false);
        let val: Value = self
            .client
            .custom(cmd, vec![key, cursor_s.as_str(), "COUNT", limit_s.as_str()])
            .await
            .map_err(AppError::from_display)?;
        let arr = match val {
            Value::Array(a) => a,
            _ => return Err(AppError::Other(format!("{cmd_name} 返回非数组"))),
        };
        let next_cursor = arr
            .first()
            .and_then(|v| v.clone().convert::<String>().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let flat: Vec<String> = arr
            .get(1)
            .and_then(|v| v.clone().convert::<Vec<String>>().ok())
            .unwrap_or_default();
        Ok((next_cursor, flat))
    }
}

/// 解析 `INFO` 文本中的某个字段值。
fn parse_info(info: &str, field: &str) -> Option<String> {
    for line in info.lines() {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim() == field {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

/// 值分页默认页大小。
const VALUE_PAGE: u64 = 200;

/// 各集合类型的起始分页位置。
fn start_pos(ty: RedisType) -> PagePos {
    match ty {
        RedisType::List | RedisType::ZSet => PagePos::Offset { offset: 0 },
        RedisType::Hash | RedisType::Set => PagePos::Cursor { cursor: 0 },
        RedisType::Stream => PagePos::AfterId { id: "-".into() },
        _ => PagePos::Offset { offset: 0 },
    }
}

/// 按索引分页（list/zset）：本页满 → 下一页偏移；否则 None。
fn next_offset(offset: u64, got: usize, limit: u64) -> Option<PagePos> {
    if (got as u64) < limit {
        None
    } else {
        Some(PagePos::Offset {
            offset: offset + got as u64,
        })
    }
}

/// 解析 INFO 中某字段为 u64（缺失/非数字 → 0）。
fn parse_info_u64(info: &str, field: &str) -> u64 {
    parse_info(info, field)
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(0)
}

/// 解析 INFO Keyspace 段：`db0:keys=1234,expires=10,avg_ttl=0` → ("db0", 1234)。
fn parse_keyspace(info: &str) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    for line in info.lines() {
        let line = line.trim();
        if !line.starts_with("db") {
            continue;
        }
        let Some((db, rest)) = line.split_once(':') else {
            continue;
        };
        if !db.starts_with("db") {
            continue;
        }
        for part in rest.split(',') {
            if let Some(v) = part.trim().strip_prefix("keys=") {
                if let Ok(n) = v.trim().parse::<u64>() {
                    out.push((db.to_string(), n));
                }
            }
        }
    }
    out
}

/// 把 fred `Value` 渲染成 redis-cli 风格的可读文本（递归）。
///
/// CLI（`exec_raw`）输出用：替代 Debug 格式，让终端里看得清。
/// - RESP2 的 map 以偶数长度 `Array` 传 → 经 [`Value::is_maybe_map`] 判定后按 `k: v` 成对渲染。
fn value_to_readable(v: &Value) -> String {
    match v {
        Value::Boolean(b) => b.to_string(),
        Value::Integer(i) => i.to_string(),
        Value::Double(f) => f.to_string(),
        Value::String(s) => s.to_string(),
        Value::Bytes(b) => String::from_utf8_lossy(&b[..]).into_owned(),
        Value::Null => "(nil)".into(),
        Value::Queued => "QUEUED".into(),
        Value::Map(m) => {
            if m.is_empty() {
                "(empty map)".into()
            } else {
                m.iter()
                    .map(|(k, val)| format!("{}: {}", k.as_str_lossy(), value_to_readable(val)))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        Value::Array(a) => {
            if a.is_empty() {
                "(empty array)".into()
            } else if v.is_maybe_map() {
                // RESP2：偶数长度数组代表 map
                a.chunks(2)
                    .filter(|c| c.len() == 2)
                    .map(|c| format!("{}: {}", value_to_readable(&c[0]), value_to_readable(&c[1])))
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                a.iter()
                    .enumerate()
                    .map(|(i, item)| format!("{}) {}", i + 1, value_to_readable(item)))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
    }
}

/// PTTL（毫秒）→ `KeyBrief.ttl`（秒，向上取整）。
/// - `-2`（key 不存在）/ `-1`（无过期）/ 其它负值 → `None`
/// - `ms >= 0` → `Some((ms + 999) / 1000)`
fn pttl_to_ttl(pttl: i64) -> Option<i64> {
    match pttl {
        ms if ms >= 0 => Some((ms + 999) / 1000),
        _ => None,
    }
}

/// `RedisType` → fred `ScanType`（SCAN TYPE 服务端过滤）；`None`/`Unknown` 视作不过滤。
fn map_scan_type(ty: RedisType) -> Option<ScanType> {
    match ty {
        RedisType::String => Some(ScanType::String),
        RedisType::Hash => Some(ScanType::Hash),
        RedisType::List => Some(ScanType::List),
        RedisType::Set => Some(ScanType::Set),
        RedisType::ZSet => Some(ScanType::ZSet),
        RedisType::Stream => Some(ScanType::Stream),
        RedisType::None | RedisType::Unknown => None,
    }
}

#[cfg(test)]
mod tests {
    use super::pttl_to_ttl;

    #[test]
    fn pttl_to_ttl_mapping() {
        assert_eq!(pttl_to_ttl(-2), None); // key 不存在
        assert_eq!(pttl_to_ttl(-1), None); // 无过期
        assert_eq!(pttl_to_ttl(0), Some(0));
        assert_eq!(pttl_to_ttl(1), Some(1));
        assert_eq!(pttl_to_ttl(500), Some(1));
        assert_eq!(pttl_to_ttl(1000), Some(1));
        assert_eq!(pttl_to_ttl(1001), Some(2));
        assert_eq!(pttl_to_ttl(60_000), Some(60));
    }
}
