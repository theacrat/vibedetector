import { createServerFn } from "@tanstack/react-start";

import { isId, isRange } from "@/domain";
import type { ProviderId, Range } from "@/domain";

import { parseDashboard, parseOverview } from "./catalogue-data";

const loadOverview = createServerFn({ method: "GET" }).handler(async () => {
  const { readOverview } = await import("@/server/reports");
  return parseOverview(await readOverview());
});

const loadDashboard = createServerFn({ method: "GET" })
  .validator((input: { id: ProviderId; range: Range; model: string }) => {
    if (
      !isId(input.id) ||
      !isRange(input.range) ||
      typeof input.model !== "string" ||
      input.model.length > 120
    ) {
      throw new Error("Invalid provider, range or model.");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { readDashboard } = await import("@/server/reports");
    return parseDashboard(await readDashboard(data.id, data.range, data.model));
  });

class RequestError extends Error {
  public readonly status: number;
  public constructor(message: string, status: number) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => false);
    let message = "Could not reach vibedetector. Please try again.";
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      message = body.error;
    }
    throw new RequestError(message, response.status);
  }
  return response.json();
}

export { loadDashboard, loadOverview, requestJson, RequestError };
