import { useId, useRef, useState, useEffect, useMemo, useCallback } from "react";

import { categories, ranges } from "@/domain";
import type { Dashboard, Range } from "@/domain";

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

function chartLayers(
  buckets: Dashboard["buckets"],
  positionX: (index: number) => number,
  positionY: (value: number) => number,
) {
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
  return layers;
}

function chartGeometry(dashboard: Dashboard, width: number) {
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
  const layers = chartLayers(buckets, positionX, positionY);
  return {
    baseline,
    bucketBaseline,
    buckets,
    height,
    last,
    layers,
    max,
    peak,
    positionX,
    positionY,
    range,
    ratio,
    top,
    topLabel,
    width,
  };
}

function useChartWidth(
  element: React.RefObject<HTMLDivElement | null>,
  setWidth: React.Dispatch<React.SetStateAction<number>>,
) {
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
  }, [element, setWidth]);
}

function useRangeActions(onRange: (range: Range) => void) {
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
  return handleRangeActions;
}

function useChartInteraction(
  onRange: (range: Range) => void,
  width: number,
  buckets: Dashboard["buckets"],
  hovered: number | undefined,
  setHovered: React.Dispatch<React.SetStateAction<number | undefined>>,
  peak: number,
  top: (typeof categories)[number] | undefined,
) {
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
  const handleRangeActions = useRangeActions(onRange);
  const leaveChart = useCallback(() => {
    setHovered(undefined);
  }, [setHovered]);
  const moveChart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const nearest = Math.round(
        ((event.clientX - rect.left - 34) / (width - 44)) * (buckets.length - 1),
      );
      setHovered(Math.max(0, Math.min(buckets.length - 1, nearest)));
    },
    [width, buckets.length, setHovered],
  );
  return { bucket, handleRangeActions, leaveChart, moveChart, tipStyle, topStyle };
}

function useChartModel(dashboard: Dashboard, onRange: (range: Range) => void) {
  const uid = useId().replaceAll(":", "");
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [hovered, setHovered] = useState<number>();
  useChartWidth(element, setWidth);
  const geometry = chartGeometry(dashboard, width);
  const { buckets, peak, top } = geometry;
  const interaction = useChartInteraction(onRange, width, buckets, hovered, setHovered, peak, top);
  return { ...geometry, ...interaction, asOf: dashboard.asOf, element, hovered, uid };
}

type ChartModel = ReturnType<typeof useChartModel> & { pending: boolean };

export { useChartModel, colors, categoryStyles };
export type { ChartModel };
