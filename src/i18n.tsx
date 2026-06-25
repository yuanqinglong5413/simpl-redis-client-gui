// 轻量 i18n：message-as-key（key = 中文原文；locale=zh 时恒等，locale=en 查 EN 表）。
// 漏译的字符串会原样回退中文，不会崩。{var} 占位由 t(s, vars) 替换。
// 语言：首次按 navigator.language 探测（en* → en，否则 zh），之后按用户选择持久化。
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type Locale = "en" | "zh";
const EN: Record<string, string> = {
  // —— Sidebar ——
  新建连接: "New connection",
  默认: "Default",
  "(未命名)": "(unnamed)",
  展开侧栏: "Expand sidebar",
  折叠侧栏: "Collapse sidebar",
  "还没有连接": "No connections yet",
  "点击右上 + 新建": "Click + above to create one",
  断开: "Disconnect",
  编辑: "Edit",
  删除: "Delete",
  "轻量开源": "lightweight & open-source",

  // —— MainPane ——
  "未选择连接": "No connection selected",
  "从左侧选择一个连接，或点击 + 新建": "Pick a connection on the left, or click + to create one.",
  重试: "Retry",
  内存: "Memory",
  监控: "Monitor",
  "正在连接…": "Connecting…",
  "加载终端…": "Loading terminal…",

  // —— StatusBar ——
  延迟: "latency",

  // —— ConnectionForm ——
  编辑连接: "Edit connection",
  关闭: "Close",
  名称: "Name",
  分组: "Group",
  主机: "Host",
  端口: "Port",
  库: "DB",
  "用户名（可选）": "Username (optional)",
  "密码（可选）": "Password (optional)",
  "密码（留空保持不变）": "Password (leave blank to keep)",
  "本地 Redis": "Local Redis",
  "使用 TLS（rediss://）": "Use TLS (rediss://)",
  "经 SSH 隧道（堡垒机）连接": "Connect via SSH tunnel (bastion)",
  "SSH 主机": "SSH host",
  "SSH 用户名": "SSH username",
  认证方式: "Auth method",
  密码: "Password",
  私钥文件: "Private key file",
  "SSH 密码": "SSH password",
  "SSH 密码（留空保持不变）": "SSH password (leave blank to keep)",
  "私钥路径（如 ~/.ssh/id_rsa）": "Private key path (e.g. ~/.ssh/id_rsa)",
  "私钥口令（可选）": "Passphrase (optional)",
  "私钥口令（留空保持不变）": "Passphrase (leave blank to keep)",
  "提示：SSH 隧道与 TLS 不应同时启用（测试/连接会被拒绝）。":
    "Note: SSH tunnel and TLS should not be enabled together (test/connect will be rejected).",
  "浏览偏好（高级）": "Browse preferences (advanced)",
  已自定义: "Customized",
  "默认：每页 200 · 分隔符 : · 树 · 自动刷新 2s":
    "Defaults: 200/page · separator : · tree · auto-refresh 2s",
  "每页 Key 数": "Keys per page",
  "树分隔符（留空=默认 :）": "Tree separator (blank = default :)",
  默认视图: "Default view",
  "自动刷新间隔（秒，0=关闭）": "Auto-refresh interval (sec, 0 = off)",
  "默认（树）": "Default (tree)",
  树: "Tree",
  平铺: "Flat",
  "连接成功 · Redis {version} · {mode}": "Connected · Redis {version} · {mode}",
  测试连接: "Test connection",
  保存: "Save",
  "保存中…": "Saving…",

  // —— KeyBrowser ——
  全部: "All",
  秒: "seconds",
  重命名: "Rename",
  复制: "Duplicate",
  设置: "Set",
  "搜索 key，如 user（自动前缀匹配，回车刷新）":
    "Search keys, e.g. user (auto prefix match, Enter to refresh)",
  完全匹配: "Exact match",
  "按类型过滤": "Filter by type",
  "勾选后仅显示 key 名完全相等的": "Show only keys whose name matches exactly",
  视图: "View",
  刷新: "Refresh",
  "集群模式仅 db 0": "Cluster mode: db 0 only",
  "切换数据库": "Switch database",
  "没有匹配的 key": "No matching keys",
  "输入 pattern 并刷新": "Enter a pattern and refresh",
  "已加载 {n} 条，建议收窄 pattern 或开启虚拟滚动（后续优化）":
    "Loaded {n} keys; narrow the pattern or enable virtualization (planned).",
  "加载中…": "Loading…",
  加载更多: "Load more",
  "已加载全部": "All loaded",
  "切换 DB 失败：{msg}": "Failed to switch DB: {msg}",
  "拖拽调整宽度": "Drag to resize",
  已复制: "Copied",
  复制失败: "Copy failed",
  "计算中…": "Calculating…",
  "{key}：无法获取大小": "{key}: size unavailable",
  "{key}：{bytes}": "{key}: {bytes}",
  "扫描中…": "Scanning…",
  "{count} 个 key · {bytes}": "{count} keys · {bytes}",
  "已删除": "Deleted",
  "已重命名": "Renamed",
  "复制失败（Redis < 6.2 不支持 COPY）": "Copy failed (Redis < 6.2 has no COPY)",
  "秒数无效": "Invalid seconds",
  "已设置 {n} 个 key 的 TTL": "TTL set on {n} keys",
  "已取消 {n} 个 key 的 TTL": "TTL cleared on {n} keys",
  "统计中…": "Counting…",
  "删除中…": "Deleting…",
  "已删除 {n} 个 key": "Deleted {n} keys",
  "删除 Key": "Delete key",
  删除目录: "Delete namespace",
  "重命名 Key": "Rename key",
  "复制 Key": "Duplicate key",
  "设置目录 TTL": "Set namespace TTL",
  "确认删除 {key} ？": "Delete {key}?",
  "将删除 {count} 个 key（匹配 {prefix}）。此操作不可撤销！":
    "This will delete {count} keys (matching {prefix}). Irreversible!",
  "新 key 名（目标已存在会被覆盖）": "New key name (existing target will be overwritten)",
  "目标 key 名（已存在将覆盖）": "Target key name (existing will be overwritten)",
  "匹配 {count} 个 key（{prefix}）。输入秒数；留空 = 取消过期（设为持久）":
    "Matches {count} keys ({prefix}). Enter seconds; blank = clear expiry (persist)",
  复制前缀: "Copy prefix",
  确认: "Confirm",
  "复制 Key 名": "Copy key name",
  只查看此目录: "View this namespace only",
  只查看所在目录: "View parent namespace",
  "查看目录存储大小": "Namespace memory size",
  查看存储大小: "Memory size",
  "删除此目录": "Delete namespace",
  确定: "OK",
  "处理中…": "Working…",

  // —— ValueTabs ——
  "点击左侧 key 查看值（可多开标签对比）": "Click a key on the left to view its value (open multiple tabs to compare)",
  "关闭全部": "Close all",
  "关闭标签": "Close tab",

  // —— ValuePanel ——
  持久: "persistent",
  已过期: "expired",
  "· 自动刷新": " · auto-refresh",
  "更多操作": "More actions",
  "设 TTL": "Set TTL",
  "确认删除": "Confirm delete",
  设为: "Apply",
  设为持久: "Make persistent",
  当前: "current",
  "读取中…": "Loading…",
  约: "~",
  "{n} 条": "{n} items",
  页: "",
  "‹ 上一页": "‹ Prev",
  "下一页 ›": "Next ›",
  第: "Page",
  "可继续加载": "More available",
  已全部: "All loaded",

  // —— editors ——
  "(空)": "(empty)",
  "加载编辑器…": "Loading editor…",
  格式化: "Format",
  原始: "Raw",
  "已截断（共 {n} 字符）": "Truncated ({n} chars total)",
  "JSON 格式错误：{msg}": "Invalid JSON: {msg}",
  JSON: "JSON",
  文本: "Text",
  压缩: "Minify",
  取消: "Cancel",
  "值过大已截断，树视图不可用，请改用「格式化」查看。":
    "Value too large (truncated); tree view unavailable — use Format instead.",
  新字段: "New field",
  值: "Value",
  新增: "Add",
  改: "Edit",
  删: "Del",
  "左(LPUSH)": "Left (LPUSH)",
  "右(RPUSH)": "Right (RPUSH)",
  "追加元素": "Append item",
  追加: "Append",
  新成员: "New member",
  添加: "Add",
  成员: "Member",
  分值: "Score",

  // —— StreamViewer ——
  "无 entry": "No entries",

  // —— JsonTree ——
  "(空数组)": "(empty array)",
  "(空对象)": "(empty object)",
  "… 还有 {n} 项未渲染（超过上限 {max}）": "… {n} more hidden (limit {max})",

  // —— MemoryAnalysis ——
  开始分析: "Analyze",
  类型: "Type",
  占用: "Usage",
  重新分析: "Re-analyze",
  "分析中…": "Analyzing…",
  "扫描当前 db 全部 key 计算占用，大库可能较慢":
    "Scans all keys in the current DB to compute usage; large DBs may be slow.",
  "Key 总数": "Total keys",
  总占用: "Total usage",
  "当前 db 无 key": "No keys in this DB",
  "点击「开始分析」扫描当前 db，定位占用最大的 key。":
    'Click "Analyze" to scan the current DB and find the largest keys.',

  // —— ServerMonitor ——
  "服务器监控": "Server monitor",
  已用内存: "Used memory",
  "峰值 {x}": "peak {x}",
  连接客户端: "Connected clients",
  "ops/秒": "ops/sec",
  命中率: "Hit rate",
  运行时长: "Uptime",
  累计命令: "Total commands",
  "命中/未命中": "Hits / misses",
  "各 db key 数": "Keys per DB",
  "慢日志（最近 50）": "Slowlog (last 50)",
  "无慢日志": "No slowlog entries",
  耗时: "Duration",
  命令: "Command",
  客户端: "Client",

  // —— CliTerminal ——
  "redis-cli（内置）— 回车执行，↑/↓ 翻历史；危险命令需输入 yes 确认":
    "redis-cli (built-in) — Enter to run, ↑/↓ for history; dangerous commands require typing yes",
  "⚠ 即将执行: {raw}": "⚠ About to run: {raw}",
  "输入 yes 确认，其它取消": "Type yes to confirm, anything else cancels",
  已取消: "Cancelled",

  // —— Pub/Sub panel ——
  订阅类型: "Subscription type",
  频道: "Channel",
  模式: "Pattern",
  "频道名，如 news": "Channel name, e.g. news",
  "模式，如 news.*": "Pattern, e.g. news.*",
  订阅: "Subscribe",
  "订阅列表": "Subscriptions",
  "无订阅": "No subscriptions",
  "发布消息": "Publish message",
  "消息内容": "Message body",
  发布: "Publish",
  "已送达 {n} 个订阅者": "Delivered to {n} subscriber(s)",
  "发布失败": "Publish failed",
  消息: "Messages",
  清空: "Clear",
  "暂无消息": "No messages yet",
  开启: "Start",
  停止: "Stop",
  "MONITOR 仅支持单机/哨兵模式；会显著增加服务器负载，按需开启。":
    "MONITOR supports standalone/sentinel only; it adds significant server load — enable as needed.",
  "暂无命令": "No commands yet",

  // —— Settings ——
  "应用设置": "Settings",
  主题: "Theme",
  "跟随系统": "System",
  亮色: "Light",
  暗色: "Dark",
  字号: "Font size",
  小: "Small",
  中: "Medium",
  大: "Large",
  语言: "Language",
  布局: "Layout",
  "恢复默认布局": "Reset layout",
  完成: "Done",

  // —— 连接重连 ——
  "连接已断开，正在重连…": "Connection lost, reconnecting…",
  "连接不稳定，正在重连…": "Connection unstable, reconnecting…",

  // —— 值内搜索 ——
  "过滤（当前页）": "Filter (current page)",

  // —— Stream 消费组 ——
  消费组: "Consumer groups",
  "无消费组": "No consumer groups",
  组名: "Group name",
  "起始 id（$ 仅新 / 0 全部）": "Start id ($ new / 0 all)",
  新建组: "Create group",
  删除组: "Delete group",
  消费者: "Consumers",
  待处理: "Pending",
  "无待处理": "No pending entries",
  "空闲(ms)": "Idle (ms)",
  投递: "Deliveries",
};

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (s: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

function detect(): Locale {
  try {
    return (navigator.language || "zh").toLowerCase().startsWith("en") ? "en" : "zh";
  } catch {
    return "zh";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      const stored = localStorage.getItem("rc:locale");
      if (stored === "en" || stored === "zh") return stored;
    } catch {
      /* ignore */
    }
    return detect();
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem("rc:locale", l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (s: string, vars?: Record<string, string | number>) => {
      let out = locale === "en" ? (EN[s] ?? s) : s;
      if (vars) {
        for (const k in vars) {
          out = out.split(`{${k}}`).join(String(vars[k]));
        }
      }
      return out;
    },
    [locale],
  );

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useT() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}
