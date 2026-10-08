import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { findProvider, isRange, type Dashboard, type Overview, type Range } from "@/domain";
import { Chart } from "@/ui/chart";
import { loadDashboard, loadOverview, requestJson } from "@/ui/data";
import { ProviderGrid } from "@/ui/providers";
import { usePublicRefresh } from "@/ui/refresh";
import { Report } from "@/ui/report";

export const Route = createFileRoute("/$provider")({
  validateSearch: (search: Record<string, unknown>): { range: Range } => ({
    range:
      typeof search["range"] === "string" && isRange(search["range"]) ? search["range"] : "24h",
  }),
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: async ({ params, deps }) => {
    const provider = findProvider(params.provider);
    if (!provider) throw notFound();
    const [dashboard, overview] = await Promise.all([
      loadDashboard({ data: { id: provider.id, range: deps.range } }),
      loadOverview(),
    ]);
    return { dashboard, overview };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `How's ${loaderData.dashboard.provider.name} feeling? - vibedetector`
          : "AI reports - vibedetector",
      },
    ],
  }),
  component: ProviderPage,
});

function ProviderPage() {
  const loaded = Route.useLoaderData();
  const [publicData, setPublicData] = useState(loaded);
  const latest = useRef(loaded);
  latest.current = loaded;
  useEffect(() => setPublicData(loaded), [loaded]);
  const { dashboard, overview } = publicData;
  const navigate = Route.useNavigate();
  const [changing, setChanging] = useState(false);
  const [rangeError, setRangeError] = useState("");
  const refreshError = usePublicRefresh(async () => {
    const snapshot = latest.current;
    const [nextDashboard, nextOverview] = await Promise.all([
      requestJson<Dashboard>(
        `/api/providers/${snapshot.dashboard.provider.id}?range=${snapshot.dashboard.range}`,
      ),
      requestJson<Overview[]>("/api/overview"),
    ]);
    if (latest.current === snapshot)
      setPublicData({ dashboard: nextDashboard, overview: nextOverview });
  });
  const provider = dashboard.provider;
  const verdictColor = {
    "insufficient community data": "var(--muted)",
    "no report spike": "var(--ok)",
    "vibes are off": "var(--slow)",
    "killed the vibe": "var(--broken)",
  }[dashboard.verdict];
  async function changeRange(range: Range) {
    setChanging(true);
    setRangeError("");
    try {
      await navigate({ search: { range }, resetScroll: false });
    } catch {
      setRangeError("Could not load that range. Please try again.");
    } finally {
      setChanging(false);
    }
  }
  return (
    <main className="wrap" id="main">
      <section className="hero">
        <div className="who">
          <div className="mono-tile" aria-hidden="true">
            {provider.name[0]}
          </div>
          <div>
            <p className="maker">{provider.maker}</p>
            <h1>How's {provider.name} feeling?</h1>
            <p className="verdict" style={{ borderColor: verdictColor, color: verdictColor }}>
              <span className="dot" aria-hidden="true" />
              {dashboard.verdict}
            </p>
            <p className="sub">
              <b>{dashboard.hourly.toLocaleString("en-GB")}</b> issue reports this hour.
            </p>
            <a
              className="status-link"
              href={provider.status}
              target="_blank"
              rel="noopener noreferrer"
            >
              {provider.maker} official status
            </a>
          </div>
        </div>
        <Report id={provider.id} key={provider.id} />
      </section>
      {(rangeError || refreshError) && (
        <p role="alert" className="error">
          {rangeError || refreshError}
        </p>
      )}
      <Chart
        dashboard={dashboard}
        onRange={(range) => {
          void changeRange(range);
        }}
        pending={changing}
      />
      <section className="elsewhere">
        <h2>Other AIs</h2>
        <ProviderGrid overview={overview.filter((entry) => entry.provider.id !== provider.id)} />
      </section>
    </main>
  );
}
