import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({ router: { generatedRouteTree: "src/generated/routeTree.gen.ts" } }),
    react(),
  ],
  resolve: {
    alias: {
      "#": new URL("src/generated", import.meta.url).pathname,
      "@": new URL("src", import.meta.url).pathname,
    },
  },
});
