// 设置模态：外观（主题/字号）、语言、恢复默认布局。套 ConnectionForm 同款 overlay。
import { RotateCcw, X } from "lucide-react";
import {
  type FontScale,
  type Theme,
  useSettings,
} from "../settings";
import { useT } from "../i18n";
import { Segmented } from "./ui";

// 布局类 localStorage 键（恢复默认时清掉）。
const LAYOUT_KEYS = [
  "rc:view",
  "rc:splitPct",
  "rc:sidebarCollapsed",
  "rc:mainTab",
];

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const { t, locale, setLocale } = useT();
  const { theme, setTheme, fontScale, setFontScale } = useSettings();

  const resetLayout = () => {
    for (const k of LAYOUT_KEYS) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    }
    // 刷新以让布局组件重新读取默认值。
    location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">{t("应用设置")}</h2>
          <button
            onClick={onClose}
            title={t("关闭")}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4 text-sm">
          {/* 外观 — 主题 */}
          <Row label={t("主题")}>
            <Segmented<Theme>
              value={theme}
              onChange={setTheme}
              options={[
                { value: "system", label: t("跟随系统") },
                { value: "light", label: t("亮色") },
                { value: "dark", label: t("暗色") },
              ]}
            />
          </Row>

          {/* 外观 — 字号 */}
          <Row label={t("字号")}>
            <Segmented<FontScale>
              value={fontScale}
              onChange={setFontScale}
              options={[
                { value: "sm", label: t("小") },
                { value: "md", label: t("中") },
                { value: "lg", label: t("大") },
              ]}
            />
          </Row>

          {/* 语言 */}
          <Row label={t("语言")}>
            <Segmented
              value={locale}
              onChange={(l) => setLocale(l)}
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "English" },
              ]}
            />
          </Row>

          {/* 布局 */}
          <Row label={t("布局")}>
            <button
              onClick={resetLayout}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              <RotateCcw size={12} />
              {t("恢复默认布局")}
            </button>
          </Row>
        </div>

        <div className="flex justify-end border-t border-neutral-800 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md bg-red-600 px-4 py-1.5 text-xs text-white hover:bg-red-500"
          >
            {t("完成")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-neutral-400">{label}</span>
      {children}
    </div>
  );
}
