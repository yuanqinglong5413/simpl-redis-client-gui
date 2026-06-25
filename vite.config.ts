import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 推荐的 Vite 配置（dev 端口 1420 与 tauri.conf.json 的 devUrl 对齐）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "0.0.0.0",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
});
