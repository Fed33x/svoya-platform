import { defineConfig } from "vite";
export default defineConfig({
  root: "web",
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/socket.io": { target: "http://localhost:3000", ws: true },
      "/media": "http://localhost:3000",
    },
  },
});
