import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { parseOverview } from "@/ui/catalogue-data";
import { loadOverview, requestJson } from "@/ui/data";
import { ProviderGrid } from "@/ui/providers";
import { usePublicRefresh } from "@/ui/refresh";

const Route = createFileRoute("/")({
  // Route hooks depend on the exported route, so the component is declared below it.
  // oxlint-disable-next-line eslint/no-use-before-define
  component: Home,
  loader: async () => loadOverview(),
});

function Home() {
  const loaded = Route.useLoaderData();
  const [refreshed, setRefreshed] = useState({ data: loaded, source: loaded });
  const overview = refreshed.source === loaded ? refreshed.data : loaded;
  const error = usePublicRefresh(async () => {
    setRefreshed({
      data: parseOverview(await requestJson<unknown>("/api/overview")),
      source: loaded,
    });
  });
  return (
    <main className="wrap" id="main">
      <section className="home-hero">
        <p className="maker">Community-powered AI reports</p>
        <h1>How&apos;s your AI feeling?</h1>
        <p className="sub">Quality, latency, availability. What&apos;s the vibe?</p>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="elsewhere">
        <h2>All AIs</h2>
        <ProviderGrid overview={overview} />
      </section>
    </main>
  );
}

export { Route };
