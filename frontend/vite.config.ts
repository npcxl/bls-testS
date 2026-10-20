import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 前端默认 5173；后端默认 8080（已开启 CORS，可直接跨域调用）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
});
