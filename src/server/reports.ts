import { env } from "cloudflare:workers";

import { findProvider, isRange, providers } from "../domain";
import type { Dashboard, Overview, Range } from "../domain";
import { aggregate } from "./aggregation";
import { loadReports } from "./storage";

export async function readDashboard(id: string, range: Range): Promise<Dashboard> {
  if (!isRange(range)) {
    throw new Error("Invalid range");
  }
  const provider = findProvider(id);
  if (!provider) {
    throw new Error("Unknown provider");
  }
  const now = Date.now();
  return aggregate(provider, range, await loadReports(env.DB, provider.id, now), now);
}

export async function readOverview(): Promise<Overview[]> {
  const now = Date.now();
  return Promise.all(
    providers.map(async (provider) => {
      const dashboard = aggregate(
        provider,
        "24h",
        await loadReports(env.DB, provider.id, now),
        now,
      );
      return { buckets: dashboard.buckets, hourly: dashboard.hourly, provider };
    }),
  );
}
