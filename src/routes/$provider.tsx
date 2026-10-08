import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";

import { findProvider, isRange } from "@/domain";
import type { Dashboard, Overview, Range } from "@/domain";
import { Chart } from "@/ui/chart";
import { loadDashboard, loadOverview, requestJson } from "@/ui/data";
import { ProviderGrid } from "@/ui/providers";
import { usePublicRefresh } from "@/ui/refresh";
import { Report } from "@/ui/report";

const Route = createFileRoute("/$provider")({
  // Route hooks depend on the exported route, so the component is declared below it.
  // oxlint-disable-next-line eslint/no-use-before-define
  component: ProviderPage,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `How's ${loaderData.dashboard.provider.name} feeling? - vibedetector`
          : "AI reports - vibedetector",
      },
    ],
  }),
  loader: async ({
    params,
    deps,
  }: {
    params: { provider: string };
    deps: { range: Range };
  }): Promise<{ dashboard: Dashboard; overview: Overview[] }> => {
    const provider = findProvider(params.provider);
    if (!provider) {
      // TanStack Router handles its typed not-found sentinel, not an Error.
      // oxlint-disable-next-line typescript/only-throw-error
      throw notFound();
    }
    const [dashboard, overview] = await Promise.all([
      loadDashboard({ data: { id: provider.id, range: deps.range } }),
      loadOverview(),
    ]);
    return { dashboard, overview };
  },
  loaderDeps: ({ search }) => ({ range: search.range }),
  validateSearch: (search: Record<string, unknown>): { range: Range } => ({
    range:
      typeof search["range"] === "string" && isRange(search["range"]) ? search["range"] : "24h",
  }),
});

function useProviderData() {
  const loaded = Route.useLoaderData();
  const [refreshed, setRefreshed] = useState({ data: loaded, source: loaded });
  const latest = useRef(loaded);
  useEffect(() => {
    latest.current = loaded;
  }, [loaded]);
  const { dashboard, overview } = refreshed.source === loaded ? refreshed.data : loaded;
  const refreshError = usePublicRefresh(async () => {
    const snapshot = latest.current;
    const [nextDashboard, nextOverview] = await Promise.all([
      requestJson<Dashboard>(
        `/api/providers/${snapshot.dashboard.provider.id}?range=${snapshot.dashboard.range}`,
      ),
      requestJson<Overview[]>("/api/overview"),
    ]);
    if (latest.current === snapshot) {
      setRefreshed({
        data: { dashboard: nextDashboard, overview: nextOverview },
        source: snapshot,
      });
    }
  });
  return { dashboard, overview, refreshError };
}

function useProviderRange() {
  const navigate = Route.useNavigate();
  const [changing, setChanging] = useState(false);
  const [rangeError, setRangeError] = useState("");
  const changeRange = useCallback(
    async (range: Range) => {
      setChanging(true);
      setRangeError("");
      try {
        await navigate({ resetScroll: false, search: { range } });
      } catch {
        setRangeError("Could not load that range. Please try again.");
      }
      setChanging(false);
    },
    [navigate],
  );
  const selectRange = useCallback(
    (range: Range) => {
      void changeRange(range);
    },
    [changeRange],
  );
  return { changing, rangeError, selectRange };
}

function ProviderHero({ dashboard }: { dashboard: Dashboard }) {
  const { provider } = dashboard;
  const verdictColor = {
    "insufficient community data": "var(--muted)",
    "killed the vibe": "var(--broken)",
    "no report spike": "var(--ok)",
    "vibes are off": "var(--slow)",
  }[dashboard.verdict];
  const verdictStyle = useMemo(
    () => ({ borderColor: verdictColor, color: verdictColor }),
    [verdictColor],
  );
  return (
    <div className="who">
      <div className="mono-tile" aria-hidden="true">
        {provider.name[0]}
      </div>
      <div>
        <p className="maker">{provider.maker}</p>
        <h1>
          {"How's "}
          {provider.name}
          {" feeling?"}
        </h1>
        <p className="verdict" style={verdictStyle}>
          <span className="dot" aria-hidden="true" />
          {dashboard.verdict}
        </p>
        <p className="sub">
          <b>{dashboard.hourly.toLocaleString("en-GB")}</b>issue reports this hour.
        </p>
        <a className="status-link" href={provider.status} target="_blank" rel="noopener noreferrer">
          {provider.maker}
          {" official status"}
        </a>
      </div>
    </div>
  );
}

function ProviderPage() {
  const { dashboard, overview, refreshError } = useProviderData();
  const { changing, rangeError, selectRange } = useProviderRange();
  const { provider } = dashboard;
  const otherProviders = useMemo(
    () => overview.filter((entry) => entry.provider.id !== provider.id),
    [overview, provider.id],
  );
  return (
    <main className="wrap" id="main">
      <section className="hero">
        <ProviderHero dashboard={dashboard} />
        <Report id={provider.id} key={provider.id} />
      </section>
      {(rangeError || refreshError) && (
        <p role="alert" className="error">
          {rangeError || refreshError}
        </p>
      )}
      <Chart dashboard={dashboard} onRange={selectRange} pending={changing} />
      <section className="elsewhere">
        <h2>Other AIs</h2>
        <ProviderGrid overview={otherProviders} />
      </section>
    </main>
  );
}

export { Route };
