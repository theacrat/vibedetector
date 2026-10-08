import { useId, useRef, useState, useEffect } from "react";
import { Button } from "react-aria-components";

import { categories, ranges, type Dashboard, type Range } from "@/domain";

const colors = { nerfed: "#b48cff", slow: "#ffb81c", broken: "#ff3d2e" };
export function timeLabel(t: number, range: Range) {
  return new Intl.DateTimeFormat(
    "en-GB",
    range === "7d"
      ? { weekday: "short", timeZone: "UTC" }
      : { hour: "2-digit", minute: "2-digit", timeZone: "UTC" },
  ).format(t);
}

export function Chart({
  dashboard,
  onRange,
  pending,
}: {
  dashboard: Dashboard;
  onRange: (range: Range) => void;
  pending: boolean;
}) {
  const uid = useId().replaceAll(":", "");
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [hovered, setHovered] = useState<number | null>(null);
  useEffect(() => {
    if (!element.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const { buckets, range, baseline } = dashboard;
  const totals = buckets.map((bucket) => bucket.nerfed + bucket.slow + bucket.broken);
  const peak = Math.max(0, ...totals);
  const max = Math.max(4, Math.ceil((peak * 1.1) / 4) * 4);
  const height = width < 560 ? 300 : Math.min(420, Math.max(260, width * 0.38));
  const x = (i: number) => 34 + (i / Math.max(1, buckets.length - 1)) * (width - 44);
  const y = (v: number) => height - 26 - (v / max) * (height - 52);
  const sums = categories.map((category) =>
    buckets.reduce((sum, bucket) => sum + bucket[category], 0),
  );
  const top = peak === 0 ? null : categories[sums.indexOf(Math.max(...sums))];
  const last = totals.at(-1) ?? 0;
  const ratio = baseline !== null && baseline > 0 ? dashboard.hourly / baseline : null;
  const bucketBaseline = baseline === null ? null : (baseline * ranges[range].step) / 3_600_000;
  const cum = buckets.map(() => 0);
  const layers = (["broken", "slow", "nerfed"] as const).map((category) => {
    const lower = buckets.map((_, index) => `${x(index)},${y(cum[index] ?? 0)}`);
    buckets.forEach((bucket, index) => {
      cum[index] = (cum[index] ?? 0) + bucket[category];
    });
    const upper = buckets.map((_, index) => `${x(index)},${y(cum[index] ?? 0)}`);
    return { category, path: `M${upper.join(" L")} L${lower.reverse().join(" L")}Z` };
  });
  const bucket = hovered === null ? undefined : buckets[hovered];
  return (
    <section className="chart-card" aria-label="Community reports">
      <div className="chart-head">
        <div>
          <h3>Reports</h3>
          <p className="now">
            <span className="live" aria-hidden="true" />
            <b>{last.toLocaleString("en-GB")}</b> in the last {ranges[range].label}
          </p>
        </div>
        <div className="ranges" role="group" aria-label="Time range">
          {(Object.keys(ranges) as Range[]).map((value) => (
            <Button
              key={value}
              aria-pressed={range === value}
              isDisabled={pending}
              onPress={() => onRange(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>
      <div
        className="chart"
        ref={element}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHovered(
            Math.max(
              0,
              Math.min(
                buckets.length - 1,
                Math.round(
                  ((event.clientX - rect.left - 34) / (width - 44)) * (buckets.length - 1),
                ),
              ),
            ),
          );
        }}
        onPointerLeave={() => setHovered(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Reports over ${range}. Peak ${peak}. ${peak === 0 ? "No community reports in this range." : `Most reported ${top}.`}`}
        >
          <defs>
            {categories.map((category) => (
              <linearGradient key={category} id={`${uid}-${category}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={colors[category]} />
                <stop offset="1" stopColor={colors[category]} stopOpacity=".78" />
              </linearGradient>
            ))}
          </defs>
          {[0, 1, 2, 3, 4].map((k) => (
            <g key={k}>
              <line
                className="grid-line"
                x1="34"
                x2={width - 10}
                y1={y((max / 4) * k)}
                y2={y((max / 4) * k)}
              />
              {k > 0 && (
                <text className="axis" x="26" y={y((max / 4) * k) + 4} textAnchor="end">
                  {(max / 4) * k}
                </text>
              )}
            </g>
          ))}
          {buckets.length > 0 &&
            [0, 1, 2, 3, 4].map((k) => {
              const i = Math.round((k / 4) * (buckets.length - 1));
              const point = buckets[i];
              return (
                point && (
                  <text
                    className="axis"
                    key={k}
                    x={x(i)}
                    y={height - 6}
                    textAnchor={k === 0 ? "start" : k === 4 ? "end" : "middle"}
                  >
                    {k === 4 ? "now" : timeLabel(point.t, range)}
                  </text>
                )
              );
            })}
          {peak > 0 &&
            layers.map(({ category, path }) => (
              <path key={category} d={path} fill={`url(#${uid}-${category})`} />
            ))}
          {bucketBaseline !== null && bucketBaseline <= max && (
            <g>
              <line
                className="baseline"
                x1="34"
                x2={width - 10}
                y1={y(bucketBaseline)}
                y2={y(bucketBaseline)}
              />
              <text className="baseline-label" x="40" y={y(bucketBaseline) - 6}>
                normal
              </text>
            </g>
          )}
          {peak === 0 && (
            <text className="axis" x={width / 2} y={height / 2} textAnchor="middle">
              No community reports yet
            </text>
          )}
          {hovered !== null && bucket && (
            <line className="cursor on" x1={x(hovered)} x2={x(hovered)} y1="16" y2={height - 26} />
          )}
        </svg>
        {bucket && hovered !== null && (
          <div className="tip" style={{ left: Math.max(75, Math.min(width - 75, x(hovered))) }}>
            <div className="t">{timeLabel(bucket.t, range)} UTC</div>
            {categories.map((category) => (
              <div className="row" key={category}>
                <span>
                  <i style={{ background: colors[category] }} />
                  {category}
                </span>
                <b>{bucket[category]}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="stats">
        <div>
          <span>Most reported</span>
          <b style={top ? { color: colors[top] } : undefined}>{top ?? "—"}</b>
        </div>
        <div>
          <span>Peak</span>
          <b>{peak.toLocaleString("en-GB")}</b>
        </div>
        <div>
          <span>vs. normal</span>
          <b>{ratio === null ? "—" : `${ratio.toFixed(1)}×`}</b>
        </div>
      </div>
      <p className="chart-note">
        Times shown in UTC.{" "}
        {baseline === null
          ? "Not enough history for a normal baseline."
          : "Dashed line shows the historical baseline."}
      </p>
    </section>
  );
}
