import { useMemo } from "react";

import type { Dashboard, Range } from "@/domain";

import { useChartModel } from "./chart-model";
import { ChartHead, ChartSvg, ChartTip, ChartStats } from "./chart-sections";

function Chart({
  dashboard,
  onRange,
  pending,
}: {
  dashboard: Dashboard;
  onRange: (range: Range) => void;
  pending: boolean;
}) {
  const chart = useChartModel(dashboard, onRange);
  const model = useMemo(() => ({ ...chart, pending }), [chart, pending]);
  const { element, moveChart, leaveChart, baseline } = model;
  return (
    <section className="chart-card" aria-label="Community reports">
      <ChartHead model={model} />
      <div className="chart" ref={element} onPointerMove={moveChart} onPointerLeave={leaveChart}>
        <ChartSvg model={model} />
        <ChartTip model={model} />
      </div>
      <ChartStats model={model} />
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
