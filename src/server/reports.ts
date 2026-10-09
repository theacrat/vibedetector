import { env } from "cloudflare:workers";

import type { Dashboard, ModelOption, Overview, Provider, ProviderId, Range } from "@/domain";

import { loadActiveModels, loadProviders } from "./catalogue";
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

async function readProviders(): Promise<Provider[]> {
  return loadProviders(env.DB, true);
}

export { readDashboard, readOverview, readModels, readProviders };
