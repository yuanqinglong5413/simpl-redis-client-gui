// 基于 CodeMirror 6 的代码编辑器（懒加载，约 130KB gzip，仅 String 编辑时加载）。
// JSON 模式：语法高亮 + 括号匹配 + 实时解析校验（jsonParseLinter，错处标红）。
// 主题：暗色用 oneDark；亮色用默认浅色。底色/字色走 CSS 变量随主题翻转；切主题经
// compartment 热重配，不重建编辑器（保留内容/光标）。
import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { linter, lintGutter } from "@codemirror/lint";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { useSettings } from "../../settings";

interface Props {
  value: string;
  onChange: (v: string) => void;
  language: "json" | "text";
}

function langExtensions(language: Props["language"]) {
  return language === "json" ? [json(), lintGutter(), linter(jsonParseLinter())] : [];
}

/** 底色/字色/槽背景走 CSS 变量（见 styles.css），两主题自动翻转。 */
const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "rgb(var(--c-base))",
    color: "rgb(var(--c-fg0))",
    fontSize: "13px",
  },
  ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, monospace" },
  ".cm-gutters": { backgroundColor: "rgb(var(--c-base))", border: "none" },
});

/** 暗色叠加 oneDark 语法高亮；亮色仅基础主题（默认浅色 token 配色）。 */
function themeExt(dark: boolean) {
  return dark ? [oneDark, baseTheme] : [baseTheme];
}

export function CodeEditor({ value, onChange, language }: Props) {
  const { resolvedTheme } = useSettings();
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 创建一次。
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          EditorView.lineWrapping,
          langComp.current.of(langExtensions(language)),
          themeComp.current.of(themeExt(resolvedTheme === "dark")),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
      parent: host.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 value 变化（如格式化/压缩按钮、初始值）→ 同步到编辑器（仅当不同，避免循环）。
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  // 切语言 → 重配。
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langComp.current.reconfigure(langExtensions(language)),
    });
  }, [language]);

  // 切主题 → 重配（不重建编辑器）。
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeComp.current.reconfigure(themeExt(resolvedTheme === "dark")),
    });
  }, [resolvedTheme]);

  return (
    <div
      ref={host}
      className="h-72 w-full overflow-hidden rounded-lg border border-neutral-800"
    />
  );
}
