import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = "http://localhost:4321";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": server, "/cal.ics": server, "/health": server },
  },
});
