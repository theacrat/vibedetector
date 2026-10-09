import { createServerFn } from "@tanstack/react-start";

import { findProvider, isRange, isModelFilter } from "@/domain";
import type { ProviderId, Range } from "@/domain";

const loadOverview = createServerFn({ method: "GET" }).handler(async () => {
  const { readOverview } = await import("@/server/reports");
  return readOverview();
});

const loadDashboard = createServerFn({ method: "GET" })
  .validator((input: { id: ProviderId; range: Range; model: string }) => {
    if (!findProvider(input.id) || !isRange(input.range) || !isModelFilter(input.id, input.model)) {
      throw new Error("Invalid provider, range or model.");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { readDashboard } = await import("@/server/reports");
    return readDashboard(data.id, data.range, data.model);
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
