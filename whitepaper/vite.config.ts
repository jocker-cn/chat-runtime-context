import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const root = resolve(import.meta.dirname);

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), viteSingleFile()],
  server: {
    host: "127.0.0.1",
    port: 5174,
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
  },
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 8_000,
  },
});
