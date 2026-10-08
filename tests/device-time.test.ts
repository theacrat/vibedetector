import { describe, expect, it } from "vitest";

import { timeLabel } from "@/ui/chart-label";

describe("device-local chart labels", () => {
  it("uses the selected device timezone across a day boundary", () => {
    const timestamp = Date.UTC(2026, 0, 1, 0, 30);
    expect(timeLabel(timestamp, "24h", "America/Los_Angeles")).toBe("16:30");
    expect(timeLabel(timestamp, "7d", "America/Los_Angeles")).toBe("Wed");
    expect(timeLabel(timestamp, "24h", "Australia/Sydney")).toBe("11:30");
  });
  it("respects the device timezone's daylight-saving transition", () => {
    expect(timeLabel(Date.UTC(2026, 2, 8, 6, 30), "24h", "America/New_York")).toBe("01:30");
    expect(timeLabel(Date.UTC(2026, 2, 8, 7, 30), "24h", "America/New_York")).toBe("03:30");
  });
});
