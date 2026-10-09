import { env } from "cloudflare:workers";

import type { Dashboard, ModelOption, Overview, ProviderId, Range } from "@/domain";

import { loadActiveModels } from "./catalogue";
import { dashboardFromDatabase, overviewFromDatabase } from "./queries";

async function readDashboard(id: string, range: Range, model = ""): Promise<Dashboard> {
  return dashboardFromDatabase(env.DB, id, range, Date.now(), model);
}

async function readOverview(): Promise<Overview[]> {
  return overviewFromDatabase(env.DB, Date.now());
}

async function readModels(id: ProviderId): Promise<ModelOption[]> {
  return loadActiveModels(env.DB, id);
}

export { readDashboard, readOverview, readModels };
