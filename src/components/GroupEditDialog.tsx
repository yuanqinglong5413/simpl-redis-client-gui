// 分组 新建/编辑 模态：名称(key) + 环境(Dev/Staging/Prod) + 颜色 + 备注。
// 编辑模式 name 改变 → 先 rename 再 upsert；底部「删除分组」（仅编辑模式，二次确认）。
import { useState } from "react";
import { X } from "lucide-react";
import type { GroupEnv, GroupMeta } from "../types";
import { DEFAULT_GROUP } from "../types";
import { useGroups } from "../hooks/useGroups";
import { useT } from "../i18n";

/** 预设色板（hex 字符串，与 GroupMeta.color 一致）。 */
const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

const inputCls =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-red-500";

interface Props {
  /** 编辑模式传入现有分组；新建模式传 null。 */
  initial: GroupMeta | null;
  /** 新建时的初始 order（由调用方算 maxOrder+1）。编辑模式忽略。 */
  newOrder?: number;
  /** 新建成功后回调新建分组名（供调用方自动选中）。 */
  onCreated?: (name: string) => void;
  onClose: () => void;
}

export function GroupEditDialog({ initial, newOrder, onCreated, onClose }: Props) {
  const { t } = useT();
  const { upsert, rename, remove, groups } = useGroups();
  const editing = initial !== null;
  const [name, setName] = useState(initial?.name ?? "");
  const [environment, setEnvironment] = useState<GroupEnv>(initial?.environment ?? "dev");
  const [color, setColor] = useState<string | null>(initial?.color ?? null);
  const [note, setNote] = useState<string>(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const trimmed = name.trim();
  const nameChanged = editing && trimmed !== initial!.name;
  const nameConflict = nameChanged
    ? groups.some((g) => g.name === trimmed)
    : !editing
      ? groups.some((g) => g.name === trimmed)
      : false;
  const canSave = trimmed.length > 0 && trimmed !== DEFAULT_GROUP && !nameConflict;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (editing && nameChanged) {
        await rename(initial!.name, trimmed);
      }
      await upsert({
        name: trimmed,
        environment,
        order: editing ? initial!.order : newOrder ?? 1,
        color,
        note: note.trim() || null,
        created_at: editing ? initial!.created_at : 0,
      });
      if (!editing && onCreated) onCreated(trimmed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    setSaving(true);
    try {
      await remove(initial!.name);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const envCls = (env: GroupEnv) =>
    environment === env
      ? env === "prod"
        ? "border-red-500 bg-red-600/20 text-red-300"
        : env === "staging"
          ? "border-amber-500 bg-amber-600/20 text-amber-300"
          : "border-emerald-500 bg-emerald-600/20 text-emerald-300"
      : "border-neutral-700 text-neutral-400 hover:bg-neutral-800";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <h2 className="text-base font-semibold text-neutral-100">
            {editing ? t("编辑分组") : t("新建分组")}
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-100"
            aria-label={t("关闭")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">{t("名称")}</span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("如：生产环境")}
              autoFocus
            />
            {nameConflict && (
              <span className="mt-1 block text-xs text-red-400">{t("分组名已存在")}</span>
            )}
          </label>

          <div>
            <span className="mb-1 block text-xs text-neutral-400">{t("环境")}</span>
            <div className="flex gap-1.5">
              {(["dev", "staging", "prod"] as GroupEnv[]).map((env) => (
                <button
                  key={env}
                  onClick={() => setEnvironment(env)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${envCls(env)}`}
                >
                  {env === "prod" ? t("生产") : env === "staging" ? t("预发") : t("开发")}
                </button>
              ))}
            </div>
            {environment === "prod" && (
              <p className="mt-1 text-[11px] text-red-400/80">
                {t("生产环境的连接，删除/FLUSH 等危险操作将强制二次确认。")}
              </p>
            )}
          </div>

          <div>
            <span className="mb-1 block text-xs text-neutral-400">{t("颜色")}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setColor(null)}
                className={`h-6 w-6 rounded-full border-2 ${
                  color === null ? "border-neutral-200" : "border-neutral-700"
                }`}
                title={t("无")}
              />
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-full border-2 ${
                    color === c ? "border-neutral-200" : "border-transparent"
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs text-neutral-400">{t("备注")}</span>
            <input
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("可选")}
            />
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-800 px-5 py-3">
          <div className="min-w-0">
            {editing &&
              (confirmDel ? (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-neutral-400">
                    {t("组内连接将移至默认组。")}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleDelete}
                      disabled={saving}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      {t("确认删除")}
                    </button>
                    <button
                      onClick={() => setConfirmDel(false)}
                      className="text-xs text-neutral-400 hover:text-neutral-200"
                    >
                      {t("取消")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDel(true)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  {t("删除分组")}
                </button>
              ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              {t("取消")}
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {saving ? t("保存中…") : t("保存")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
