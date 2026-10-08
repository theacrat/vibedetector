import { createFileRoute } from "@tanstack/react-router";

const Route = createFileRoute("/methodology")({
  component: () => (
    <main className="wrap prose" id="main">
      <p className="maker">About vibedetector</p>
      <h1>Methodology</h1>
      <h2>Community signals, not outage declarations</h2>
      <p>
        {
          "People report when their AI feels nerfed, slow or broken. These are subjective experiences.\n A report spike can suggest a shared issue, but does not establish its cause or prove a\n provider is down. Check the linked official status page for the provider's own assessment."
        }
      </p>
      <h2>Counts and charts</h2>
      <p>
        Switching category updates your current report. Tap the selected category to undo. The
        hourly count covers the last hour. Chart intervals are 15 minutes for 6h, 30 minutes for 24h
        and 3 hours for 7d. Times are displayed in your local timezone.
      </p>
      <h2>Baseline and verdict</h2>
      <p>
        Sufficient data means at least 100 non-retracted reports in the previous 48 complete hours,
        plus an older report showing that reporting history spans at least 48 hours. The normal
        baseline is the number of reports in that period divided by 48.
      </p>
      <p>
        Vibes are off when the last hour has at least 10 reports and twice the normal hourly
        average. Killed the vibe means at least 20 reports and five times that average. Otherwise we
        show no report spike, not confirmed healthy service.
      </p>
      <p>
        {
          "Verdicts compare recent report activity with historical activity. When history or report\n volume is insufficient, we show “insufficient community data” rather than implying good\n service. An empty chart means no community reports in that range, not a healthy service\n guarantee."
        }
      </p>
      <h2>Limitations</h2>
      <p>
        {
          "Self-selected reports are not a representative survey. Turnstile, rate limiting and browser\n deduplication mitigate abuse but cannot guarantee unique humans. Public data refreshes\n approximately once a minute."
        }
      </p>
    </main>
  ),
  head: () => ({ meta: [{ title: "Methodology - vibedetector" }] }),
});

export { Route };
