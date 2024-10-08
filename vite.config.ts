import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

declare const __dirname: string;

// https://vitejs.dev/config/
export default defineConfig({
  base: "graphology-layout-forceatlas2-gpu",
  resolve: { alias: { src: resolve("src/") } },
  plugins: [dts({ include: ["src"] })],
});
