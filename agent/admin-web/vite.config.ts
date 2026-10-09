import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Servido pelo agente em /admin (Dockerfile copia dist/ para app/static/admin/).
export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5180,
    proxy: { "/admin/api": "http://localhost:8090" },
  },
  build: { chunkSizeWarningLimit: 900 },
});
