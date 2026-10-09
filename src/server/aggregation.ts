import { ranges } from "@/domain";
import type { Bucket, Dashboard, Provider, Range } from "@/domain";

import { HOUR } from "./storage";
import type { Report } from "./storage";

export function aggregate(
  provider: Provider,
  range: Range,
  reports: Report[],
  now: number,
  model = "",
): Dashboard {
  const { count, step } = ranges[range];
  const start = Math.floor(now / step) * step - count * step;
  const cutoff = now - count * step;
  const buckets: Bucket[] = Array.from({ length: count + 1 }, (_value, index) => ({
    broken: 0,
    nerfed: 0,
    slow: 0,
    t: start + index * step,
  }));
  let hourly = 0;
  const baselineEnd = Math.floor(now / HOUR) * HOUR;
  const baselineStart = baselineEnd - 48 * HOUR;
  let baselineCount = 0;
  for (const report of reports) {
    if (report.created_at > now || report.category === null) {
      continue;
    }
    if (report.created_at >= now - HOUR) {
      hourly += 1;
    }
    if (report.created_at >= baselineStart && report.created_at < baselineEnd) {
      baselineCount += 1;
    }
    const bucket = buckets[Math.floor((report.created_at - start) / step)];
    const matchesModel =
      model === "" || (model === "unspecified" ? !report.model : report.model === model);
    if (bucket && report.created_at >= cutoff && matchesModel) {
      bucket[report.category] += 1;
    }
  }
  const history = reports.some((report) => report.created_at <= baselineStart);
  // The dashboard contract uses null for an unavailable baseline, never zero.
  // oxlint-disable-next-line unicorn/no-null
  const baseline = history && baselineCount >= 100 ? baselineCount / 48 : null;
  let verdict: Dashboard["verdict"] = "insufficient community data";
  if (baseline !== null) {
    verdict = "no report spike";
    if (hourly >= Math.max(20, baseline * 5)) {
      verdict = "killed the vibe";
    } else if (hourly >= Math.max(10, baseline * 2)) {
      verdict = "vibes are off";
    }
  }
  return { asOf: now, baseline, buckets, hourly, model, provider, range, verdict };
}
