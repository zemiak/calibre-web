import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api is proxied to the calibre content server: CALIBRE_API, a local one by default
// (CALIBRE_API=https://calibre.example.com npm run dev for another). In production nginx does the same.
const target = process.env.CALIBRE_API ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target,
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
