import { Button } from "react-aria-components";

import { categories } from "@/domain";

import { timeLabel } from "./chart-label";
import { colors, categoryStyles } from "./chart-model";
import type { ChartModel } from "./chart-model";
import { useDeviceTimeZone } from "./device-time";
import { ModelSelect } from "./model-select";

function textAnchor(tick: number) {
  if (tick === 0) {
    return "start";
  }
  if (tick === 4) {
    return "end";
  }
  return "middle";
}

function ChartHead({ model }: { model: ChartModel }) {
  const { range, handleRangeActions, pending, filter, providerId, onModel } = model;
  return (
    <div className="chart-head">
      <h3>Reports</h3>
      <div className="chart-controls">
        <ModelSelect id={providerId} value={filter} onChange={onModel} disabled={pending} filter />
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
    </div>
  );
}

function ChartDefinitions({ model }: { model: ChartModel }) {
  const { uid } = model;
  return (
    <defs>
      {categories.map((category) => (
        <linearGradient key={category} id={`${uid}-${category}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colors[category]} />
          <stop offset="1" stopColor={colors[category]} stopOpacity=".78" />
        </linearGradient>
      ))}
    </defs>
  );
}

function ChartAxes({ model }: { model: ChartModel }) {
  const timeZone = useDeviceTimeZone();
  const { max, width, positionY, positionX, height, buckets, range } = model;
  return (
    <>
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
              {tick === 4 ? "now" : timeLabel(point.t, range, timeZone)}
            </text>
          )
        );
      })}
    </>
  );
}

function ChartBaseline({ model }: { model: ChartModel }) {
  const { bucketBaseline, max, width, positionY } = model;
  return (
    bucketBaseline !== undefined &&
    bucketBaseline <= max && (
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
    )
  );
}

function ChartAreas({ model }: { model: ChartModel }) {
  const { peak, layers, uid, width, height, hovered, bucket, positionX } = model;
  return (
    <>
      {peak > 0 &&
        layers.map(({ category, path }) => (
          <path key={category} d={path} fill={`url(#${uid}-${category})`} />
        ))}
      <ChartBaseline model={model} />
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
    </>
  );
}

function ChartSvg({ model }: { model: ChartModel }) {
  const { width, height, range, peak, top } = model;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      // SVG needs an explicit image role for its accessible chart summary.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="img"
      aria-label={`Reports over ${range}. Peak ${peak}. ${peak === 0 ? "No community reports in this range." : `Most reported ${top}.`}`}
    >
      <ChartDefinitions model={model} />
      <ChartAxes model={model} />
      <ChartAreas model={model} />
    </svg>
  );
}

function ChartTip({ model }: { model: ChartModel }) {
  const timeZone = useDeviceTimeZone();
  const { bucket, hovered, tipStyle, range } = model;
  return (
    bucket &&
    hovered !== undefined && (
      <div className="tip" style={tipStyle}>
        <div className="timestamp">
          {range === "7d" && `${timeLabel(bucket.t, "7d", timeZone)} `}
          {timeLabel(bucket.t, "24h", timeZone)}
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
    )
  );
}

function ChartStats({ model }: { model: ChartModel }) {
  const { topStyle, topLabel, peak, ratio } = model;
  return (
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
  );
}

export { ChartHead, ChartSvg, ChartTip, ChartStats };
