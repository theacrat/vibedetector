import { findProvider, isRange, providers } from "@/domain";
import type { Dashboard, Overview, Range } from "@/domain";

import { aggregate } from "./aggregation";
import { loadModels } from "./catalogue";
import { loadReports } from "./storage";

async function dashboardFromDatabase(
  db: D1Database,
  id: string,
  range: Range,
  now: number,
  model = "",
): Promise<Dashboard> {
  const provider = findProvider(id);
  if (!provider || !isRange(range)) {
    throw new Error("Invalid dashboard query");
  }
  const models = await loadModels(db, provider.id);
  const filter =
    model === "unspecified" || models.some((entry) => entry.name === model) ? model : "";
  return {
    ...aggregate(provider, range, await loadReports(db, provider.id, now), now, filter),
    models,
  };
}

async function overviewFromDatabase(db: D1Database, now: number): Promise<Overview[]> {
  return Promise.all(
    providers.map(async (provider) => {
      const dashboard = await dashboardFromDatabase(db, provider.id, "24h", now);
      return { buckets: dashboard.buckets, hourly: dashboard.hourly, provider };
    }),
  );
}

export { dashboardFromDatabase, overviewFromDatabase };
