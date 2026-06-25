//! fred Spike 集成测试 —— 对应 ADR-001 的四项验收门槛。
//!
//! 这些测试**需要真实 Redis** 运行在 `127.0.0.1:6379`，因此默认 `#[ignore]`。
//!
//! 运行方式（先装好并启动 redis-server）：
//! ```sh
//! brew install redis && brew services start redis   # 或 redis-server --daemonize yes
//! cargo test -p redis-core --test spike -- --ignored --nocapture
//! ```
//!
//! 覆盖 ADR 验收门槛：
//! 1. 连接 + INFO 解析（ping）
//! 2. SCAN 增量分页
//! 3. 基本类型读取（String / Hash）
//! 4. 任意命令执行（exec_raw）+ DEL

use redis_core::{FredConnectConfig, FredGateway, RedisGateway, RedisType, ScanCursor, ValueView};

/// 连接本地 Redis（失败时给出清晰提示）。
async fn gw() -> FredGateway {
    let cfg = FredConnectConfig::new("127.0.0.1", 6379, None, 0);
    FredGateway::connect(cfg)
        .await
        .expect("连接 redis 失败：请先启动 redis-server（如 `brew services start redis`）")
}

/// 门槛 1：连接 + INFO 解析（含 version/mode）
#[tokio::test]
#[ignore]
async fn t01_ping_parses_info() {
    let gw = gw().await;
    let info = gw.ping().await.expect("ping/Info 应成功");
    assert!(info.reachable);
    assert!(
        info.version.is_some(),
        "应从 INFO 解析出 redis_version，实际: {info:?}"
    );
    println!("redis_version = {:?}, mode = {:?}", info.version, info.mode);
}

/// 门槛 2：SCAN 增量分页 + 类型识别
#[tokio::test]
#[ignore]
async fn t02_scan_finds_keys() {
    let gw = gw().await;
    // 用 exec_raw 准备数据
    for i in 0..5 {
        gw.exec_raw(&["SET".into(), format!("m0:scan:{i}"), "v".into()])
            .await
            .unwrap();
    }

    let mut found = 0;
    let mut cursor = ScanCursor::START;
    loop {
        let page = gw
            .scan(cursor, Some("m0:scan:*"), None, 100)
            .await
            .expect("scan");
        found += page
            .keys
            .iter()
            .filter(|k| k.key.starts_with("m0:scan:"))
            .count();
        cursor = page.next_cursor;
        if cursor.is_done() {
            break;
        }
    }
    assert!(
        found >= 5,
        "SCAN 应至少找到 5 个 m0:scan:* key，实际 {found}"
    );

    // 清理
    gw.exec_raw(&["DEL".into(), "m0:scan:0".into()])
        .await
        .unwrap();
    gw.exec_raw(&["DEL".into(), "m0:scan:1".into()])
        .await
        .unwrap();
    gw.exec_raw(&["DEL".into(), "m0:scan:2".into()])
        .await
        .unwrap();
    gw.exec_raw(&["DEL".into(), "m0:scan:3".into()])
        .await
        .unwrap();
    gw.exec_raw(&["DEL".into(), "m0:scan:4".into()])
        .await
        .unwrap();
}

/// 门槛 3：String 类型 key_type + read_value
#[tokio::test]
#[ignore]
async fn t03_string_read() {
    let gw = gw().await;
    gw.exec_raw(&["SET".into(), "m0:str".into(), "hello".into()])
        .await
        .unwrap();

    assert_eq!(
        gw.key_type("m0:str").await.unwrap(),
        Some(RedisType::String)
    );

    match gw.read_value("m0:str", RedisType::String).await.unwrap() {
        ValueView::String { value, is_json } => {
            assert_eq!(value, "hello");
            assert!(!is_json);
        }
        other => panic!("期望 String 视图，实际 {other:?}"),
    }

    assert!(gw.del("m0:str").await.unwrap());
    assert_eq!(gw.key_type("m0:str").await.unwrap(), None);
}

/// 门槛 3（续）：Hash 类型读取
#[tokio::test]
#[ignore]
async fn t04_hash_read() {
    let gw = gw().await;
    gw.exec_raw(&["HSET".into(), "m0:hash".into(), "f1".into(), "v1".into()])
        .await
        .unwrap();
    gw.exec_raw(&["HSET".into(), "m0:hash".into(), "f2".into(), "v2".into()])
        .await
        .unwrap();

    match gw.read_value("m0:hash", RedisType::Hash).await.unwrap() {
        ValueView::Hash { fields } => {
            assert_eq!(fields.len(), 2);
        }
        other => panic!("期望 Hash 视图，实际 {other:?}"),
    }

    gw.del("m0:hash").await.unwrap();
}

/// 门槛 4：exec_raw 执行 + DBSIZE
#[tokio::test]
#[ignore]
async fn t05_exec_and_dbsize() {
    let gw = gw().await;
    let before = gw.dbsize().await.unwrap();
    gw.exec_raw(&["SET".into(), "m0:db".into(), "1".into()])
        .await
        .unwrap();
    let after = gw.dbsize().await.unwrap();
    assert!(after > before, "DBSIZE 应在 SET 后增加");
    gw.del("m0:db").await.unwrap();
}
