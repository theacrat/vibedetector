import { ranges } from "../domain";
import type { Bucket, Dashboard, Provider, Range } from "../domain";
import { HOUR } from "./storage";
import type { Report } from "./storage";

export function aggregate(
  provider: Provider,
  range: Range,
  reports: Report[],
  now: number,
): Dashboard {
  const { count, step } = ranges[range];
  const start = Math.floor(now / step) * step - (count - 1) * step;
  const buckets: Bucket[] = Array.from({ length: count }, (_, index) => ({
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
      hourly++;
    }
    if (report.created_at >= baselineStart && report.created_at < baselineEnd) {
      baselineCount++;
    }
    const bucket = buckets[Math.floor((report.created_at - start) / step)];
    if (bucket) {
      bucket[report.category]++;
    }
  }
  const history = reports.some((report) => report.created_at <= baselineStart);
  const baseline = history && baselineCount >= 100 ? baselineCount / 48 : null;
  const verdict =
    baseline === null
      ? "insufficient community data"
      : hourly >= Math.max(20, baseline * 5)
        ? "killed the vibe"
        : hourly >= Math.max(10, baseline * 2)
          ? "vibes are off"
          : "no report spike";
  return { asOf: now, baseline, buckets, hourly, provider, range, verdict };
}
