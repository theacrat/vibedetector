import { useEffect, useRef } from "react";

import { useAdmin } from "./admin-data";
import { AdminScreens } from "./admin-screens";

import "./admin.css";

type AdminScreen = { kind: "list" } | { kind: "edit"; providerId: string };

const listScreen: AdminScreen = { kind: "list" };

function ModelAdmin({ screen = listScreen }: { screen?: AdminScreen }) {
  const state = useAdmin();
  const heading = useRef<HTMLHeadingElement>(null);
  const authenticated = state.models !== undefined;
  const provider =
    screen.kind === "edit"
      ? state.providers.find((entry) => entry.id === screen.providerId)
      : undefined;
  let title = "Providers";
  if (screen.kind === "edit") {
    title = provider ? `${provider.name} catalogue` : "Provider not found";
  }
  useEffect(() => {
    if (authenticated) {
      heading.current?.focus();
    }
  }, [authenticated]);
  return (
    <main className="wrap admin" id="main">
      <p className="maker">Administration</p>
      <h1 ref={heading} tabIndex={-1}>
        {authenticated ? title : "Catalogue administration"}
      </h1>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.pending && <output>Loading catalogue...</output>}
      <AdminScreens state={state} screen={screen} />
    </main>
  );
}

export { ModelAdmin };
export type { AdminScreen };
