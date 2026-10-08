import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import type { Overview } from "@/domain";

const defaultSearch = { range: "24h" as const };

export function ProviderGrid({ overview }: { overview: Overview[] }) {
  const paramsById = useMemo(
    () => new Map(overview.map(({ provider }) => [provider.id, { provider: provider.id }])),
    [overview],
  );
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
        const params = paramsById.get(provider.id);
        if (!params) {
          return;
        }

        return (
          <article className="card" key={provider.id}>
            <Link
              className="card-main"
              to="/$provider"
              params={params}
              search={defaultSearch}
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
              <span className="card-count">
                {hourly.toLocaleString("en-GB")}
                {" reports this hour"}
              </span>
            </Link>
          </article>
        );
      })}
    </div>
  );
}
