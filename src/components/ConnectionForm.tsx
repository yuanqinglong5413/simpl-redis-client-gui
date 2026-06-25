// 连接 新建/编辑 模态表单。
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2, Plug, X } from "lucide-react";
import type { ConnectionConfig, ConnPrefs, ServerInfo, SshTunnelConfig } from "../types";
import { emptyConnection } from "../types";
import { ipc } from "../lib/ipc";
import { useT } from "../i18n";

interface Props {
  initial: ConnectionConfig | null;
  onSave: (config: ConnectionConfig) => Promise<void> | void;
  onCancel: () => void;
}

const inputCls =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-red-500";

export function ConnectionForm({ initial, onSave, onCancel }: Props) {
  const { t } = useT();
  const [form, setForm] = useState<ConnectionConfig>(initial ?? emptyConnection());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ServerInfo | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);

  const isNew = !initial || initial.id === "";
  // 是否有任一偏好被显式设置（决定折叠区是否显示「已自定义」徽标）
  const hasPrefs =
    form.prefs &&
    (form.prefs.scan_count != null ||
      form.prefs.key_separator != null ||
      form.prefs.default_view != null ||
      form.prefs.auto_refresh_secs != null);

  const set = <K extends keyof ConnectionConfig>(k: K, v: ConnectionConfig[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // 偏好子字段：空值留 undefined，由解析器套默认。
  const setPref = <K extends keyof ConnPrefs>(k: K, v: ConnPrefs[K]) =>
    setForm((f) => ({ ...f, prefs: { ...(f.prefs ?? {}), [k]: v } }));

  const numOrUndef = (s: string) => (s === "" ? undefined : Number(s));

  // SSH 隧道子字段。
  const enableSsh = () =>
    setForm((f) => ({
      ...f,
      ssh: { host: "", port: 22, user: "", auth: { kind: "password", password: "" } },
    }));
  const disableSsh = () => setForm((f) => ({ ...f, ssh: null }));
  const setSsh = (patch: Partial<SshTunnelConfig>) =>
    setForm((f) => (f.ssh ? { ...f, ssh: { ...f.ssh, ...patch } } : f));
  const setSshAuth = (patch: Partial<SshTunnelConfig["auth"]>) =>
    setForm((f) => (f.ssh ? { ...f, ssh: { ...f.ssh, auth: { ...f.ssh.auth, ...patch } } } : f));

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      setTestResult(await ipc.testConnection(form));
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <h2 className="text-base font-semibold text-neutral-100">
            {isNew ? t("新建连接") : t("编辑连接")}
          </h2>
          <button
            onClick={onCancel}
            className="text-neutral-400 hover:text-neutral-100"
            aria-label={t("关闭")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("名称")}>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={t("本地 Redis")}
              />
            </Field>
            <Field label={t("分组")}>
              <input
                className={inputCls}
                value={form.group ?? ""}
                onChange={(e) => set("group", e.target.value || null)}
                placeholder={t("默认")}
              />
            </Field>
          </div>

          <div className="grid grid-cols-[1fr_100px_90px] gap-3">
            <Field label={t("主机")}>
              <input
                className={inputCls}
                value={form.host}
                onChange={(e) => set("host", e.target.value)}
                placeholder="127.0.0.1"
              />
            </Field>
            <Field label={t("端口")}>
              <input
                className={inputCls}
                type="number"
                value={form.port}
                onChange={(e) => set("port", Number(e.target.value))}
              />
            </Field>
            <Field label={t("库")}>
              <input
                className={inputCls}
                type="number"
                value={form.db}
                onChange={(e) => set("db", Number(e.target.value))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("用户名（可选）")}>
              <input
                className={inputCls}
                value={form.username ?? ""}
                onChange={(e) => set("username", e.target.value || null)}
                placeholder="default"
              />
            </Field>
            <Field label={isNew ? t("密码（可选）") : t("密码（留空保持不变）")}>
              <input
                className={inputCls}
                type="password"
                value={form.password ?? ""}
                onChange={(e) => set("password", e.target.value)}
                placeholder="••••••"
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={form.tls}
              onChange={(e) => set("tls", e.target.checked)}
            />
            {t("使用 TLS（rediss://）")}
          </label>

          {/* SSH 隧道（可选，经堡垒机连内网 Redis） */}
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={!!form.ssh}
              onChange={(e) => (e.target.checked ? enableSsh() : disableSsh())}
            />
            {t("经 SSH 隧道（堡垒机）连接")}
          </label>
          {form.ssh && (
            <div className="space-y-3 rounded-lg border border-neutral-800 px-3 py-3">
              <div className="grid grid-cols-[1fr_100px] gap-3">
                <Field label={t("SSH 主机")}>
                  <input
                    className={inputCls}
                    value={form.ssh.host}
                    onChange={(e) => setSsh({ host: e.target.value })}
                    placeholder="bastion.example.com"
                  />
                </Field>
                <Field label={t("端口")}>
                  <input
                    className={inputCls}
                    type="number"
                    value={form.ssh.port}
                    onChange={(e) => setSsh({ port: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <Field label={t("SSH 用户名")}>
                <input
                  className={inputCls}
                  value={form.ssh.user}
                  onChange={(e) => setSsh({ user: e.target.value })}
                  placeholder="root"
                />
              </Field>
              <Field label={t("认证方式")}>
                <select
                  className={inputCls}
                  value={form.ssh.auth.kind}
                  onChange={(e) =>
                    setSshAuth({ kind: e.target.value as "password" | "private_key" })
                  }
                >
                  <option value="password">{t("密码")}</option>
                  <option value="private_key">{t("私钥文件")}</option>
                </select>
              </Field>
              {form.ssh.auth.kind === "password" ? (
                <Field label={isNew ? t("SSH 密码") : t("SSH 密码（留空保持不变）")}>
                  <input
                    className={inputCls}
                    type="password"
                    value={form.ssh.auth.password ?? ""}
                    onChange={(e) => setSshAuth({ password: e.target.value })}
                    placeholder="••••••"
                  />
                </Field>
              ) : (
                <>
                  <Field label={t("私钥路径（如 ~/.ssh/id_rsa）")}>
                    <input
                      className={inputCls}
                      value={form.ssh.auth.key_path ?? ""}
                      onChange={(e) => setSshAuth({ key_path: e.target.value })}
                      placeholder="/Users/me/.ssh/id_rsa"
                    />
                  </Field>
                  <Field label={isNew ? t("私钥口令（可选）") : t("私钥口令（留空保持不变）")}>
                    <input
                      className={inputCls}
                      type="password"
                      value={form.ssh.auth.passphrase ?? ""}
                      onChange={(e) => setSshAuth({ passphrase: e.target.value })}
                    />
                  </Field>
                </>
              )}
              {form.tls && (
                <p className="text-xs text-amber-400">
                  {t("提示：SSH 隧道与 TLS 不应同时启用（测试/连接会被拒绝）。")}
                </p>
              )}
            </div>
          )}

          {/* 浏览偏好（高级）：每页数 / 分隔符 / 默认视图 / 自动刷新间隔 */}
          <div className="rounded-lg border border-neutral-800">
            <button
              type="button"
              onClick={() => setShowPrefs((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800/40"
            >
              {showPrefs ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
              {t("浏览偏好（高级）")}
              {hasPrefs && (
                <span className="rounded bg-red-600/20 px-1.5 py-0.5 text-[10px] text-red-300">
                  {t("已自定义")}
                </span>
              )}
              {!hasPrefs && (
                <span className="text-[11px] text-neutral-600">
                  {t("默认：每页 200 · 分隔符 : · 树 · 自动刷新 2s")}
                </span>
              )}
            </button>
            {showPrefs && (
              <div className="grid grid-cols-2 gap-3 border-t border-neutral-800 px-3 py-3">
                <Field label={t("每页 Key 数")}>
                  <input
                    className={inputCls}
                    type="number"
                    min={1}
                    value={form.prefs?.scan_count ?? ""}
                    onChange={(e) => setPref("scan_count", numOrUndef(e.target.value))}
                    placeholder="200"
                  />
                </Field>
                <Field label={t("树分隔符（留空=默认 :）")}>
                  <input
                    className={inputCls}
                    value={form.prefs?.key_separator ?? ""}
                    onChange={(e) =>
                      setPref("key_separator", e.target.value || undefined)
                    }
                    placeholder=":"
                  />
                </Field>
                <Field label={t("默认视图")}>
                  <select
                    className={inputCls}
                    value={form.prefs?.default_view ?? ""}
                    onChange={(e) =>
                      setPref(
                        "default_view",
                        (e.target.value || undefined) as ConnPrefs["default_view"],
                      )
                    }
                  >
                    <option value="">{t("默认（树）")}</option>
                    <option value="tree">{t("树")}</option>
                    <option value="flat">{t("平铺")}</option>
                  </select>
                </Field>
                <Field label={t("自动刷新间隔（秒，0=关闭）")}>
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    value={form.prefs?.auto_refresh_secs ?? ""}
                    onChange={(e) =>
                      setPref("auto_refresh_secs", numOrUndef(e.target.value))
                    }
                    placeholder="2"
                  />
                </Field>
              </div>
            )}
          </div>

          {testResult && (
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
              {t("连接成功 · Redis {version} · {mode}", {
                version: testResult.version ?? "?",
                mode: testResult.mode ?? "standalone",
              })}
            </div>
          )}
          {testError && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {testError}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-800 px-5 py-3">
          <button
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          >
            {testing ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Plug size={15} />
            )}
            {t("测试连接")}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              {t("取消")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim() || !form.host.trim()}
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
