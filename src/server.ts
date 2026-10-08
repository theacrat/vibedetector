import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

import { handleApi } from "./server/api";
import { retainReports } from "./server/storage";

const start = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) {
      return handleApi(request, env);
    }
    return start(request);
  },
  async scheduled(_controller, env) {
    await retainReports(env.DB, Date.now());
  },
} satisfies ExportedHandler<Cloudflare.Env>;
