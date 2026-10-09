import { env } from "cloudflare:workers";

import type { Dashboard, Overview, Range } from "@/domain";

import { dashboardFromDatabase, overviewFromDatabase } from "./queries";

async function readDashboard(id: string, range: Range, model = ""): Promise<Dashboard> {
  return dashboardFromDatabase(env.DB, id, range, Date.now(), model);
}

async function readOverview(): Promise<Overview[]> {
  return overviewFromDatabase(env.DB, Date.now());
}

export { readDashboard, readOverview };
