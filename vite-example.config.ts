import { resolve } from "path";
import { defineConfig } from "vite";

declare const __dirname: string;

// https://vitejs.dev/config/
export default defineConfig({
  publicDir: resolve(__dirname, "example/public"),
});
