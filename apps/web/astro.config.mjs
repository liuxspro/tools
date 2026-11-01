import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://tools.liuxs.pro",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // MapLibre 的 worker 通过 import.meta.url 定位，
    // 预构建会重写该路径导致 dev 下 worker 加载失败。
    optimizeDeps: {
      exclude: ["maplibre-gl"],
    },
    worker: {
      format: "es",
    },
  },
});
