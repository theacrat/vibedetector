import { Link } from "@tanstack/react-router";

import type { Overview } from "@/domain";

export function ProviderGrid({ overview }: { overview: Overview[] }) {
  return (
    <div className="grid">
      {overview.map(({ provider, hourly, buckets }) => {
        const totals = buckets.map((bucket) => bucket.nerfed + bucket.slow + bucket.broken);
        const max = Math.max(1, ...totals) * 1.1;
        const line = totals
          .map(
            (total, index) =>
              `${index === 0 ? "M" : "L"}${(index / Math.max(1, totals.length - 1)) * 200},${44 - (total / max) * 44}`,
          )
          .join(" ");
        return (
          <article className="card" key={provider.id}>
            <Link
              className="card-main"
              to="/$provider"
              params={{ provider: provider.id }}
              search={{ range: "24h" }}
              aria-label={`View ${provider.name} reports`}
            >
              <div className="card-top">
                <b>{provider.name}</b>
              </div>
              <svg viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true">
                <path
                  d={line}
                  fill="none"
                  stroke="var(--muted)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span className="card-count">{hourly.toLocaleString("en-GB")} reports this hour</span>
            </Link>
          </article>
        );
      })}
    </div>
  );
}
