import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const apiPrefix = env.VITE_APP_BASE_API || "/api";
  const apiTarget = env.VITE_APP_API_URL || "http://localhost:8080";

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        [apiPrefix]: {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
