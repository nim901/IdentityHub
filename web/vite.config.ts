import { defineConfig } from "vite";
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
    },
  },
});
