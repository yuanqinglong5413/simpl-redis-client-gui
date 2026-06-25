// 把 app-icon.svg 渲染成 1024x1024 PNG（Tauri icon 命令的源图）。
// 用 @resvg/resvg-js（预编译原生二进制，无需编译），纯 Rust SVG 渲染器。
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync("src-tauri/icons/app-icon.svg", "utf-8");
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1024 },
  background: "rgba(0,0,0,0)",
});
const png = resvg.render().asPng();
writeFileSync("src-tauri/icons/app-icon.png", png);
console.log(`wrote src-tauri/icons/app-icon.png (${png.length} bytes)`);
