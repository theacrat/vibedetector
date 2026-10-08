import { createServerFn } from "@tanstack/react-start";

import { findProvider, isRange, type ProviderId, type Range } from "@/domain";

export const loadOverview = createServerFn({ method: "GET" }).handler(async () => {
  const { readOverview } = await import("@/server/reports");
  return readOverview();
});

export const loadDashboard = createServerFn({ method: "GET" })
  .validator((input: { id: ProviderId; range: Range }) => {
    if (!findProvider(input.id) || !isRange(input.range))
      throw new Error("Invalid provider or range.");
    return input;
  })
  .handler(async ({ data }) => {
    const { readDashboard } = await import("@/server/reports");
    return readDashboard(data.id, data.range);
  });

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Could not reach vibedetector. Please try again.");
  }
  return response.json() as Promise<T>;
}
