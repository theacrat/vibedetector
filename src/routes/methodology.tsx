import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/methodology")({
  head: () => ({ meta: [{ title: "Methodology - vibedetector" }] }),
  component: () => (
    <main className="wrap prose" id="main">
      <p className="maker">About vibedetector</p>
      <h1>Methodology</h1>
      <h2>Community signals, not outage declarations</h2>
      <p>
        People report when their AI feels nerfed, slow or broken. These are subjective experiences.
        A report spike can suggest a shared issue, but does not establish its cause or prove a
        provider is down. Check the linked official status page for the provider's own assessment.
      </p>
      <h2>Counts and charts</h2>
      <p>
        One anonymous browser can hold one report per provider per fixed UTC hour. Switching
        category updates that report. Undo removes it. The hourly count covers the last hour. Charts
        use UTC-aligned buckets of 15 minutes for 6h, 30 minutes for 24h and 3 hours for 7d.
      </p>
      <h2>Baseline and verdict</h2>
      <p>
        Verdicts compare recent report activity with historical activity. When history or report
        volume is insufficient, we show “insufficient community data” rather than implying good
        service. An empty chart means no community reports in that range, not a healthy service
        guarantee.
      </p>
      <h2>Limitations</h2>
      <p>
        Self-selected reports are not a representative survey. Turnstile, rate limiting and browser
        deduplication mitigate abuse but cannot guarantee unique humans. Public data refreshes
        approximately once a minute.
      </p>
    </main>
  ),
});
