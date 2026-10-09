import { useMemo } from "react";

import type { Dashboard, Range } from "@/domain";

import { useChartModel } from "./chart-model";
import { ChartHead, ChartSvg, ChartTip, ChartStats } from "./chart-sections";

function Chart({
  dashboard,
  onRange,
  onModel,
  pending,
}: {
  dashboard: Dashboard;
  onRange: (range: Range) => void;
  onModel: (model: string) => void;
  pending: boolean;
}) {
  const chart = useChartModel(dashboard, onRange);
  const model = useMemo(() => ({ ...chart, onModel, pending }), [chart, pending, onModel]);
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
        {"Times shown in your local timezone. "}
        {dashboard.model &&
          "Filtered reports; provider verdict uses all models. Hourly totals also use all models."}
        {!dashboard.model && baseline === null && (
          <a href="/methodology">How much data is enough?</a>
        )}
        {!dashboard.model && baseline !== null && "Dashed line shows the historical baseline."}
      </p>
    </section>
  );
}

export { Chart };
