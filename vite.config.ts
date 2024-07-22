import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

declare const __dirname: string;

// https://vitejs.dev/config/
export default defineConfig({
  build: { lib: { entry: resolve(__dirname, "src/index.ts"), formats: ["umd"], fileName: "index" } },
  resolve: { alias: { src: resolve("src/") } },
  plugins: [dts({ include: ["src"] })],
});
