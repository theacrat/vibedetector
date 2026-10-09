import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import type { Overview } from "@/domain";
import { compareProviders } from "@/provider-order";

import { ProviderLogo } from "./provider-logo";

const defaultSearch = { range: "24h" as const };

function sparkLine(buckets: Overview["buckets"]) {
  const totals = buckets.map((bucket) => bucket.nerfed + bucket.slow + bucket.broken);
  const max = Math.max(1, ...totals) * 1.1;
  const line = totals
    .map(
      (total, index) =>
        `${index === 0 ? "M" : "L"}${(index / Math.max(1, totals.length - 1)) * 200},${44 - (total / max) * 44}`,
    )
    .join(" ");
  return line;
}

export function ProviderGrid({ overview }: { overview: Overview[] }) {
  const paramsById = useMemo(
    () => new Map(overview.map(({ provider }) => [provider.id, { provider: provider.slug }])),
    [overview],
  );
  return (
    <div className="grid">
      {overview
        .filter(({ provider }) => provider.active)
        .toSorted((left, right) => compareProviders(left.provider, right.provider))
        .map(({ provider, hourly, buckets }) => {
          const line = sparkLine(buckets);
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
                  <ProviderLogo provider={provider} />
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
