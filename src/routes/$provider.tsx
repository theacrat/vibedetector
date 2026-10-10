import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";

import { isId, isRange, catalogueScope } from "@/domain";
import type { Dashboard, Overview, Range } from "@/domain";
import { parseDashboard, parseOverview } from "@/ui/catalogue-data";
import { Chart } from "@/ui/chart";
import { loadDashboard, loadOverview, requestJson } from "@/ui/data";
import { ProviderLogo } from "@/ui/provider-logo";
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
    deps: { range: Range; model: string };
  }): Promise<{ dashboard: Dashboard; overview: Overview[] }> => {
    const overview = await loadOverview();
    const provider = overview.find(
      (entry) => entry.provider.slug === params.provider && entry.provider.active,
    )?.provider;
    if (!provider) {
      // TanStack Router handles its typed not-found sentinel, not an Error.
      // oxlint-disable-next-line typescript/only-throw-error
      throw notFound();
    }
    const dashboard = await loadDashboard({
      data: {
        id: provider.id,
        model: isId(deps.model) || deps.model === "unspecified" ? deps.model : "",
        range: deps.range,
      },
    });
    if (dashboard.model !== deps.model) {
      // TanStack Router handles redirects as typed sentinels.
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({
        params: { provider: provider.slug },
        replace: true,
        search: { model: "", range: deps.range },
        to: "/$provider",
      });
    }
    return { dashboard, overview };
  },
  loaderDeps: ({ search }) => ({ model: search.model ?? "", range: search.range }),
  validateSearch: (search: Record<string, unknown>): { range: Range; model?: string } => ({
    model: typeof search["model"] === "string" ? search["model"] : "",
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
      requestJson<unknown>(
        `/api/providers/${snapshot.dashboard.provider.id}?range=${snapshot.dashboard.range}&model=${encodeURIComponent(snapshot.dashboard.model)}`,
      ),
      requestJson<unknown>("/api/overview"),
    ]);
    const parsedDashboard = parseDashboard(nextDashboard);
    const parsedOverview = parseOverview(nextOverview);
    if (latest.current === snapshot) {
      setRefreshed({
        data: { dashboard: parsedDashboard, overview: parsedOverview },
        source: snapshot,
      });
    }
  });
  return { dashboard, overview, refreshError };
}

function useProviderFilters() {
  const navigate = Route.useNavigate();
  const [changing, setChanging] = useState(false);
  const [filterError, setFilterError] = useState("");
  const changeFilters = useCallback(
    async (selection: { range?: Range; model?: string }) => {
      setChanging(true);
      setFilterError("");
      try {
        await navigate({
          resetScroll: false,
          search: (previous) => ({ ...previous, ...selection }),
        });
      } catch {
        setFilterError("Could not load those reports. Please try again.");
      }
      setChanging(false);
    },
    [navigate],
  );
  const selectRange = useCallback(
    (range: Range) => {
      void changeFilters({ range });
    },
    [changeFilters],
  );
  const selectModel = useCallback(
    (model: string) => {
      void changeFilters({ model });
    },
    [changeFilters],
  );
  return { changing, filterError, selectModel, selectRange };
}

function ProviderHero({ dashboard }: { dashboard: Dashboard }) {
  const { provider } = dashboard;
  const verdictLabel = dashboard.verdict === "no report spike" ? "good vibes" : dashboard.verdict;
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
        <ProviderLogo provider={provider} />
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
          {dashboard.verdict === "insufficient community data" ? (
            <a href="/methodology">{dashboard.verdict}</a>
          ) : (
            verdictLabel
          )}
        </p>
        <p className="sub">
          <b>{dashboard.hourly.toLocaleString("en-GB")}</b>
          {" issue reports this hour."}
        </p>
        <a className="status-link" href={provider.status} target="_blank" rel="noopener noreferrer">
          {"statusLabel" in provider && typeof provider.statusLabel === "string"
            ? provider.statusLabel
            : `${provider.maker} official status`}
        </a>
      </div>
    </div>
  );
}

function ProviderPage() {
  const { dashboard, overview, refreshError } = useProviderData();
  const { changing, filterError, selectRange, selectModel } = useProviderFilters();
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
      <p className="sub">{catalogueScope(provider.id)}</p>
      {(filterError || refreshError) && (
        <p role="alert" className="error">
          {filterError || refreshError}
        </p>
      )}
      <Chart dashboard={dashboard} onRange={selectRange} onModel={selectModel} pending={changing} />
      <section className="elsewhere">
        <h2>Other AIs</h2>
        <ProviderGrid overview={otherProviders} />
      </section>
    </main>
  );
}

export { Route };
