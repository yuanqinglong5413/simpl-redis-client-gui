// 字节数 → 人类可读（B/KB/MB/GB/TB）。
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const prec = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(prec)} ${units[i]}`;
}
