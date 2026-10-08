import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { providers, type Dashboard } from "@/domain";

import { Chart, timeLabel } from "./chart";

const empty: Dashboard = {
  provider: providers[0],
  range: "24h",
  hourly: 0,
  baseline: null,
  verdict: "insufficient community data",
  asOf: 0,
  buckets: [
    { t: 0, nerfed: 0, slow: 0, broken: 0 },
    { t: 1_800_000, nerfed: 0, slow: 0, broken: 0 },
  ],
};

describe("community reports chart", () => {
  it("renders empty activity without inventing a category or baseline", () => {
    const html = renderToStaticMarkup(
      <Chart dashboard={empty} onRange={() => {}} pending={false} />,
    );
    expect(html).toContain("No community reports yet");
    expect(html).toContain("Not enough history for a normal baseline.");
    expect(html).toContain("Most reported</span><b>—</b>");
    expect(html).not.toContain('class="baseline"');
    expect(html).not.toContain("NaN");
  });

  it("renders the supplied category totals and peak", () => {
    const dashboard: Dashboard = {
      ...empty,
      buckets: [
        { t: 0, nerfed: 2, slow: 4, broken: 1 },
        { t: 1_800_000, nerfed: 0, slow: 8, broken: 0 },
      ],
      baseline: 4,
      hourly: 8,
    };
    const html = renderToStaticMarkup(
      <Chart dashboard={dashboard} onRange={() => {}} pending={true} />,
    );
    expect(html).toContain("Peak 8. Most reported slow.");
    expect(html).toContain("2.0×");
    expect(html).toContain('class="baseline"');
    expect(html).toContain("disabled");
  });

  it("uses UTC labels regardless of local timezone", () => {
    expect(timeLabel(Date.UTC(2026, 9, 9, 13, 45), "24h")).toBe("13:45");
    expect(timeLabel(Date.UTC(2026, 9, 9, 13, 45), "7d")).toBe("Fri");
  });
});
