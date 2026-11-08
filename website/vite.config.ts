import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The website is deployed independently of the Tauri app. Keep the base path
// configurable so the same build works at a domain root or a Pages subpath.
export default defineConfig({
  plugins: [react()],
  base: process.env.WEBSITE_BASE ?? "/",
  server: {
    port: 5173,
  },
});
