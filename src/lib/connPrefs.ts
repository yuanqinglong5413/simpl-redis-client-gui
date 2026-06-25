// 连接级浏览偏好的「有效值」解析：把 Option 字段解析为带默认值的具体值。
// 集中在此便于复用与单测；调用方（KeyBrowser/useKeys/KeyTree/ValuePanel）只管用结果。
import type { ConnectionConfig } from "../types";

/** 默认每页扫描数（SCAN COUNT 是提示值）。 */
export const DEFAULT_SCAN_COUNT = 200;
/** 默认分隔符。 */
export const DEFAULT_SEPARATOR = ":";
/** 默认浏览视图。 */
export const DEFAULT_VIEW: "flat" | "tree" = "tree";
/** 默认自动刷新间隔（秒）。 */
export const DEFAULT_AUTO_REFRESH = 2;

/** 每页 key 数：< 1 或缺省回退 200。 */
export function effectiveScanCount(c?: ConnectionConfig | null): number {
  const n = c?.prefs?.scan_count;
  return typeof n === "number" && n >= 1 ? n : DEFAULT_SCAN_COUNT;
}

/** 树分隔符：缺省回退 ":"；显式空串 = 不分组（由 KeyTree 处理为单段）。 */
export function effectiveSeparator(c?: ConnectionConfig | null): string {
  return c?.prefs?.key_separator ?? DEFAULT_SEPARATOR;
}

/** 默认浏览视图：仅识别 "flat"，其余（含缺省）回退 "tree"。 */
export function effectiveDefaultView(c?: ConnectionConfig | null): "flat" | "tree" {
  return c?.prefs?.default_view === "flat" ? "flat" : DEFAULT_VIEW;
}

/** 自动刷新间隔（秒）：缺省回退 2；UI 侧把 0 当作「关闭」。 */
export function effectiveAutoRefresh(c?: ConnectionConfig | null): number {
  return c?.prefs?.auto_refresh_secs ?? DEFAULT_AUTO_REFRESH;
}
