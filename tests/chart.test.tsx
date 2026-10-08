import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { providers } from "@/domain";
import type { Dashboard } from "@/domain";
import { Chart } from "@/ui/chart";
import { timeLabel } from "@/ui/chart-label";

const empty: Dashboard = {
  asOf: 0,
  // Dashboard uses null for insufficient historical data.
  // oxlint-disable-next-line unicorn/no-null
  baseline: null,
  buckets: [
    { broken: 0, nerfed: 0, slow: 0, t: 0 },
    { broken: 0, nerfed: 0, slow: 0, t: 1_800_000 },
  ],
  hourly: 0,
  provider: providers[0],
  range: "24h",
  verdict: "insufficient community data",
};

function recordRange(range: string) {
  expect(["6h", "24h", "7d"]).toContain(range);
}

const dashboard: Dashboard = {
  ...empty,
  baseline: 4,
  buckets: [
    { broken: 1, nerfed: 2, slow: 4, t: 0 },
    { broken: 0, nerfed: 0, slow: 8, t: 1_800_000 },
  ],
  hourly: 8,
};

describe("community reports chart", () => {
  it("renders empty activity without inventing a category or baseline", () => {
    const html = renderToStaticMarkup(
      <Chart dashboard={empty} onRange={recordRange} pending={false} />,
    );
    expect(html).toContain("No community reports yet");
    expect(html).toContain("How much data is enough?");
    expect(html).toContain('href="/methodology"');
    expect(html).not.toContain("bucket (partial)");
    expect(html).toContain("Most reported</span><b>—</b>");
    expect(html).not.toContain('class="baseline"');
    expect(html).not.toContain("NaN");
    expect(html).toContain("since 00:30");
    expect(html.indexOf(">6h</button>")).toBeLessThan(html.indexOf(">24h</button>"));
    expect(html.indexOf(">24h</button>")).toBeLessThan(html.indexOf(">7d</button>"));
  });

  it("renders the supplied category totals and peak", () => {
    const html = renderToStaticMarkup(
      <Chart dashboard={dashboard} onRange={recordRange} pending />,
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
