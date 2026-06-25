// 值文本展示辅助：HTML 转义、Base64、Hex、JSON 语法高亮（无外部依赖）。

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Unicode 安全的 Base64（支持中文等非 Latin1 字符）。 */
export function toBase64(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return "(无法编码)";
  }
}

/** UTF-8 字节 → 十六进制（空格分隔）。 */
export function toHex(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
  } catch {
    return "(无法编码)";
  }
}

/** 对 JSON 文本做 token 级语法高亮（内部先转义），返回可安全 setInnerHTML 的 HTML 串。 */
export function highlightJsonHtml(json: string): string {
  const esc = escapeHtml(json);
  return esc.replace(
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "text-amber-300"; // number
      if (/^"/.test(match)) {
        cls = /:\s*$/.test(match) ? "text-sky-400" : "text-emerald-300"; // key vs string
      } else if (/^(true|false)$/.test(match)) {
        cls = "text-purple-400";
      } else if (match === "null") {
        cls = "text-neutral-500";
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}
