// 内嵌 redis-cli 风格终端：xterm.js + 行编辑 + ↑/↓ 历史 + 危险命令 yes 确认。
// 关键：行编辑状态（当前行/历史/索引）全部用闭包内的普通变量，不用 useState——
// onData 回调若读 state 会拿到旧值。activeId/prompt 变化时整个 effect 重建终端。
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "../../lib/ipc";
import { useT } from "../../i18n";
import { useSettings } from "../../settings";

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/** 终端配色随主题：暗=深底浅字，亮=白底深字（RED/YELLOW ANSI 在两底上都可读）。 */
function termTheme(dark: boolean) {
  return dark
    ? { background: "#0a0a0a", foreground: "#fafafa", cursor: "#fafafa" }
    : { background: "#ffffff", foreground: "#171717", cursor: "#171717" };
}

/** 触发二次确认的危险命令（PRD P0）。 */
const DANGER_CMD = new Set(["FLUSHALL", "FLUSHDB", "SHUTDOWN"]);

interface Props {
  activeId: string;
  /** redis-cli 风格提示符，如 `127.0.0.1:6379[0]> `。 */
  prompt: string;
}

export function CliTerminal({ activeId, prompt }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const { t } = useT();
  const { resolvedTheme } = useSettings();

  // 主题变化 → 热更新终端配色（不重建，保留历史/输入）。
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = termTheme(resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: termTheme(resolvedTheme === "dark"),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    requestAnimationFrame(() => fit.fit());

    // 把任意 \n 规整为 \r\n，避免 xterm 阶梯渲染
    const out = (s: string) => term.writeln(s.replace(/\r?\n/g, "\r\n"));
    const newPrompt = () => term.write(`\r\n${prompt}`);

    term.writeln(`${YELLOW}${t("redis-cli（内置）— 回车执行，↑/↓ 翻历史；危险命令需输入 yes 确认")}${RESET}`);
    term.write(prompt);
    termRef.current = term;

    // 行编辑状态（闭包变量）
    let line = "";
    const history: string[] = [];
    let histIdx = -1; // -1 = 当前输入行；0 = 最新一条
    let pendingDanger: { args: string[] } | null = null;

    async function run(args: string[]) {
      try {
        const result = await ipc.execCommand(activeId, args);
        if (result) out(result);
      } catch (e) {
        out(`${RED}(error) ${e instanceof Error ? e.message : String(e)}${RESET}`);
      }
      newPrompt();
    }

    function isDangerous(args: string[]): boolean {
      if (args.length === 0) return false;
      const c = args[0].toUpperCase();
      if (DANGER_CMD.has(c)) return true;
      if (c === "CONFIG") return true;
      if (c === "KEYS" && args.slice(1).some((a) => a.includes("*"))) return true;
      return false;
    }

    function submit(raw: string) {
      const args = raw.trim().split(/\s+/).filter(Boolean);
      if (args.length === 0) {
        newPrompt();
        return;
      }
      if (isDangerous(args)) {
        pendingDanger = { args };
        out(`${YELLOW}${t("⚠ 即将执行: {raw}", { raw })}${RESET}`);
        out(`${YELLOW}${t("输入 yes 确认，其它取消")}${RESET}`);
        newPrompt();
        return;
      }
      void run(args);
    }

    function clearLineAndWrite(text: string) {
      term.write("\r\x1b[K");
      term.write(text);
    }

    const off = term.onData((data) => {
      // —— 危险命令确认态：只接受整行 yes/y ——
      if (pendingDanger) {
        if (data === "\r") {
          const ans = line.trim().toLowerCase();
          term.write("\r\n");
          line = "";
          histIdx = -1;
          if (ans === "yes" || ans === "y") {
            const args = pendingDanger.args;
            pendingDanger = null;
            void run(args);
          } else {
            pendingDanger = null;
            out(t("已取消"));
            newPrompt();
          }
        } else if (data === "\x7f") {
          if (line.length > 0) {
            line = line.slice(0, -1);
            term.write("\b \b");
          }
        } else if (data >= " " && !data.startsWith("\x1b")) {
          line += data;
          term.write(data);
        }
        return;
      }

      switch (data) {
        case "\r": {
          // Enter
          const committed = line;
          term.write("\r\n");
          if (committed.trim()) {
            history.push(committed);
            histIdx = -1;
          }
          line = "";
          submit(committed);
          break;
        }
        case "\x7f": // Backspace
          if (line.length > 0) {
            line = line.slice(0, -1);
            term.write("\b \b");
          }
          break;
        case "\x1b[A": // ↑
          if (history.length > 0) {
            histIdx = histIdx === -1 ? 0 : Math.min(histIdx + 1, history.length - 1);
            const cmd = history[history.length - 1 - histIdx];
            line = cmd;
            clearLineAndWrite(prompt + cmd);
          }
          break;
        case "\x1b[B": // ↓
          if (histIdx > 0) {
            histIdx -= 1;
            const cmd = history[history.length - 1 - histIdx];
            line = cmd;
            clearLineAndWrite(prompt + cmd);
          } else if (histIdx === 0) {
            histIdx = -1;
            line = "";
            clearLineAndWrite(prompt);
          }
          break;
        default:
          // 可见字符（含粘贴/多字节）；过滤控制符与未处理的转义序列
          if (data >= " " && !data.startsWith("\x1b")) {
            line += data;
            term.write(data);
          }
      }
    });

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    return () => {
      off.dispose();
      window.removeEventListener("resize", onResize);
      term.dispose();
      termRef.current = null;
    };
  }, [activeId, prompt, t]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
