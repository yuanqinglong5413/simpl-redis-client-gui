// 主区空状态。
import { Database } from "lucide-react";

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Database size={40} className="text-neutral-500" />
      <p className="text-sm text-neutral-400">{title}</p>
      {hint && <p className="text-xs text-neutral-600">{hint}</p>}
    </div>
  );
}
