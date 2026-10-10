import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

import { handleApi } from "./server/api";
import { syncCatalogue } from "./server/catalogue-sync";
import { sitemap } from "./server/sitemap";
import { retainReports } from "./server/storage";

const start = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/sitemap.xml") {
      return sitemap(env.DB, new URL(request.url).origin);
    }
    if (path === "/api" || path.startsWith("/api/")) {
      return handleApi(request, env);
    }
    return start(request);
  },
  async scheduled(controller, env) {
    await (controller.cron === "43 3 * * *"
      ? syncCatalogue(env)
      : retainReports(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
