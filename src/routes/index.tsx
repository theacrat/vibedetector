import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { Overview } from "@/domain";
import { loadOverview, requestJson } from "@/ui/data";
import { ProviderGrid } from "@/ui/providers";
import { usePublicRefresh } from "@/ui/refresh";

export const Route = createFileRoute("/")({
  loader: () => loadOverview(),
  component: Home,
});

function Home() {
  const loaded = Route.useLoaderData();
  const [overview, setOverview] = useState(loaded);
  useEffect(() => setOverview(loaded), [loaded]);
  const error = usePublicRefresh(async () =>
    setOverview(await requestJson<Overview[]>("/api/overview")),
  );
  return (
    <main className="wrap" id="main">
      <section className="home-hero">
        <p className="maker">Community-powered AI reports</p>
        <h1>How's your AI feeling?</h1>
        <p className="sub">Quality, latency, availability. What's the vibe?</p>
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
