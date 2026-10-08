import { useId, useRef, useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "react-aria-components";

import { categories, ranges } from "@/domain";
import type { Dashboard, Range } from "@/domain";

import { timeLabel } from "./chart-label";

function textAnchor(tick: number) {
  if (tick === 0) {
    return "start";
  }
  if (tick === 4) {
    return "end";
  }
  return "middle";
}

const colors = { broken: "#ff3d2e", nerfed: "#b48cff", slow: "#ffb81c" };
const categoryStyles = {
  broken: { background: colors.broken },
  nerfed: { background: colors.nerfed },
  slow: { background: colors.slow },
};
const topStyles = {
  broken: { color: colors.broken },
  nerfed: { color: colors.nerfed },
  slow: { color: colors.slow },
};

function Chart({
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
  const [hovered, setHovered] = useState<number>();
  useEffect(() => {
    if (!element.current) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(element.current);
    return () => {
      observer.disconnect();
    };
  }, []);
  const { buckets, range, baseline } = dashboard;
  const totals = buckets.map((bucket) => bucket.nerfed + bucket.slow + bucket.broken);
  const peak = Math.max(0, ...totals);
  const max = Math.max(4, Math.ceil((peak * 1.1) / 4) * 4);
  const height = width < 560 ? 300 : Math.min(420, Math.max(260, width * 0.38));
  const positionX = (index: number) =>
    34 + (index / Math.max(1, buckets.length - 1)) * (width - 44);
  const positionY = (value: number) => height - 26 - (value / max) * (height - 52);
  const sums = categories.map((category) =>
    buckets.reduce((sum, bucket) => sum + bucket[category], 0),
  );
  const top = categories[sums.indexOf(Math.max(...sums))];
  const topLabel = peak === 0 ? "—" : top;
  const last = totals.at(-1) ?? 0;
  const ratio = baseline !== null && baseline > 0 ? dashboard.hourly / baseline : undefined;
  const bucketBaseline =
    baseline === null ? undefined : (baseline * ranges[range].step) / 3_600_000;
  const cumulativeTotals = buckets.map(() => 0);
  const layers = (["broken", "slow", "nerfed"] as const).map((category) => {
    const lower = buckets.map(
      (_bucket, index) => `${positionX(index)},${positionY(cumulativeTotals[index] ?? 0)}`,
    );
    for (const [index, bucket] of buckets.entries()) {
      cumulativeTotals[index] = (cumulativeTotals[index] ?? 0) + bucket[category];
    }
    const upper = buckets.map(
      (_bucket, index) => `${positionX(index)},${positionY(cumulativeTotals[index] ?? 0)}`,
    );
    return { category, path: `M${upper.join(" L")} L${lower.toReversed().join(" L")}Z` };
  });
  const bucket = buckets[hovered ?? -1];
  const tipStyle = useMemo(
    () => ({
      left: Math.max(
        75,
        Math.min(
          width - 75,
          34 + ((hovered ?? 0) / Math.max(1, buckets.length - 1)) * (width - 44),
        ),
      ),
    }),
    [width, hovered, buckets.length],
  );
  const topStyle = useMemo(() => (peak > 0 && top ? topStyles[top] : undefined), [peak, top]);
  const handleRangeActions = useMemo(
    () => ({
      "24h": () => {
        onRange("24h");
      },
      "6h": () => {
        onRange("6h");
      },
      "7d": () => {
        onRange("7d");
      },
    }),
    [onRange],
  );
  const leaveChart = useCallback(() => {
    setHovered(undefined);
  }, []);
  const moveChart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const nearest = Math.round(
        ((event.clientX - rect.left - 34) / (width - 44)) * (buckets.length - 1),
      );
      setHovered(Math.max(0, Math.min(buckets.length - 1, nearest)));
    },
    [width, buckets.length],
  );
  return (
    <section className="chart-card" aria-label="Community reports">
      <div className="chart-head">
        <div>
          <h3>Reports</h3>
          <p className="now">
            <span className="live" aria-hidden="true" />
            <b>{last.toLocaleString("en-GB")}</b>
            {" in current "}
            {ranges[range].label}
            {" bucket (partial)"}
          </p>
        </div>
        <fieldset className="ranges" aria-label="Time range">
          {(["6h", "24h", "7d"] as const).map((value) => (
            <Button
              key={value}
              aria-pressed={range === value}
              isDisabled={pending}
              onPress={handleRangeActions[value]}
            >
              {value}
            </Button>
          ))}
        </fieldset>
      </div>
      <div className="chart" ref={element} onPointerMove={moveChart} onPointerLeave={leaveChart}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          // SVG needs an explicit image role for its accessible chart summary.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
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
          {[0, 1, 2, 3, 4].map((tick) => (
            <g key={tick}>
              <line
                className="grid-line"
                x1="34"
                x2={width - 10}
                y1={positionY((max / 4) * tick)}
                y2={positionY((max / 4) * tick)}
              />
              {tick > 0 && (
                <text className="axis" x="26" y={positionY((max / 4) * tick) + 4} textAnchor="end">
                  {(max / 4) * tick}
                </text>
              )}
            </g>
          ))}
          {[0, 1, 2, 3, 4].map((tick) => {
            const index = Math.round((tick / 4) * (buckets.length - 1));
            const point = buckets[index];
            return (
              point && (
                <text
                  className="axis"
                  key={tick}
                  x={positionX(index)}
                  y={height - 6}
                  textAnchor={textAnchor(tick)}
                >
                  {tick === 4 ? "now" : timeLabel(point.t, range)}
                </text>
              )
            );
          })}
          {peak > 0 &&
            layers.map(({ category, path }) => (
              <path key={category} d={path} fill={`url(#${uid}-${category})`} />
            ))}
          {bucketBaseline !== undefined && bucketBaseline <= max && (
            <g>
              <line
                className="baseline"
                x1="34"
                x2={width - 10}
                y1={positionY(bucketBaseline)}
                y2={positionY(bucketBaseline)}
              />
              <text className="baseline-label" x="40" y={positionY(bucketBaseline) - 6}>
                normal
              </text>
            </g>
          )}
          {peak === 0 && (
            <text className="axis" x={width / 2} y={height / 2} textAnchor="middle">
              No community reports yet
            </text>
          )}
          {hovered !== undefined && bucket && (
            <line
              className="cursor on"
              x1={positionX(hovered)}
              x2={positionX(hovered)}
              y1="16"
              y2={height - 26}
            />
          )}
        </svg>
        {bucket && hovered !== undefined && (
          <div className="tip" style={tipStyle}>
            <div className="timestamp">
              {timeLabel(bucket.t, range)}
              {" UTC"}
            </div>
            {categories.map((category) => (
              <div className="row" key={category}>
                <span>
                  <i style={categoryStyles[category]} />
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
          <b style={topStyle}>{topLabel}</b>
        </div>
        <div>
          <span>Peak</span>
          <b>{peak.toLocaleString("en-GB")}</b>
        </div>
        <div>
          <span>vs. normal</span>
          <b>{ratio === undefined ? "—" : `${ratio.toFixed(1)}×`}</b>
        </div>
      </div>
      <p className="chart-note">
        {"Times shown in UTC. "}
        {baseline === null
          ? "Not enough history for a normal baseline."
          : "Dashed line shows the historical baseline."}
      </p>
    </section>
  );
}

export { Chart };
