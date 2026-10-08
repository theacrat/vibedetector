import { expect, it } from "vitest";

import { reportingWindowDelay } from "@/ui/report-window";

it("waits until the next hour from an integer reporting window", () => {
  expect(reportingWindowDelay(12, 45_000_000)).toBe(1_800_000);
  expect(reportingWindowDelay(12, 46_800_000)).toBe(0);
});
