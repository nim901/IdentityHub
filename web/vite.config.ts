import { defineConfig } from "vite";
const apiTarget = process.env.IDENTITYHUB_API_TARGET ?? "http://127.0.0.1:3000";
export default defineConfig({
  server: {
    proxy: {
      "/api": apiTarget,
      "/healthz": apiTarget,
    },
  },
});
