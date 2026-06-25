/** @type {import('tailwindcss').Config} */
// 主题策略：把用到的 neutral / red / sky / amber / emerald 各 shade 重定向到
// CSS 通道变量（rgb(var(--token) / <alpha-value>)），主题切换只需换 :root 变量值。
// 组件里的字面色（bg-neutral-950 等）因此全部自动随主题翻转，无需改 className。
// violet/pink/rose/purple（仅类型色点用）不覆盖，保留 Tailwind 默认，两主题都耐看。
// 变量值见 src/styles.css（:root=暗默认，[data-theme="light"]=亮）。
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        neutral: {
          950: "rgb(var(--c-base) / <alpha-value>)",
          900: "rgb(var(--c-surface) / <alpha-value>)",
          800: "rgb(var(--c-elevated) / <alpha-value>)",
          700: "rgb(var(--c-line) / <alpha-value>)",
          600: "rgb(var(--c-faint) / <alpha-value>)",
          100: "rgb(var(--c-fg0) / <alpha-value>)",
          200: "rgb(var(--c-fg0) / <alpha-value>)",
          300: "rgb(var(--c-fg1) / <alpha-value>)",
          400: "rgb(var(--c-fg2) / <alpha-value>)",
          500: "rgb(var(--c-fg3) / <alpha-value>)",
        },
        red: {
          200: "rgb(var(--danger-2) / <alpha-value>)",
          300: "rgb(var(--danger-2) / <alpha-value>)",
          400: "rgb(var(--danger) / <alpha-value>)",
          500: "rgb(var(--accent-2) / <alpha-value>)",
          600: "rgb(var(--accent) / <alpha-value>)",
          900: "rgb(var(--danger-line) / <alpha-value>)",
          950: "rgb(var(--danger-soft) / <alpha-value>)",
        },
        sky: {
          400: "rgb(var(--info) / <alpha-value>)",
        },
        amber: {
          300: "rgb(var(--warn-2) / <alpha-value>)",
          400: "rgb(var(--warn) / <alpha-value>)",
          600: "rgb(var(--warn-strong) / <alpha-value>)",
          900: "rgb(var(--warn-line) / <alpha-value>)",
          950: "rgb(var(--warn-soft) / <alpha-value>)",
        },
        emerald: {
          300: "rgb(var(--success-2) / <alpha-value>)",
          400: "rgb(var(--success) / <alpha-value>)",
          500: "rgb(var(--success-strong) / <alpha-value>)",
          600: "rgb(var(--success-strong) / <alpha-value>)",
          900: "rgb(var(--success-line) / <alpha-value>)",
          950: "rgb(var(--success-soft) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
