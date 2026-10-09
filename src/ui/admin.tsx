import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import type { Provider } from "@/domain";

import { useAdmin } from "./admin-data";
import { AdminScreens } from "./admin-screens";

import "./admin.css";

type AdminScreen = { kind: "list" } | { kind: "new" } | { kind: "edit"; providerId: string };

const listScreen: AdminScreen = { kind: "list" };

declare module "@tanstack/react-router" {
  interface HistoryState {
    savedProvider?: Provider;
  }
}

function ModelAdmin({ screen = listScreen }: { screen?: AdminScreen }) {
  const location = useLocation();
  const saved = location.state.savedProvider;
  const savedProvider =
    screen.kind === "edit" && saved?.id === screen.providerId ? saved : undefined;
  const state = useAdmin(savedProvider);
  useEffect(() => {
    if (savedProvider) {
      globalThis.history.replaceState(
        { ...globalThis.history.state, savedProvider: undefined },
        "",
        location.href,
      );
    }
  }, [location.href, savedProvider]);
  const heading = useRef<HTMLHeadingElement>(null);
  const authenticated = state.models !== undefined;
  const provider =
    screen.kind === "edit"
      ? state.providers.find((entry) => entry.id === screen.providerId)
      : undefined;
  let title = "Providers";
  if (screen.kind === "new") {
    title = "Add provider";
  }
  if (screen.kind === "edit") {
    title = provider ? `Edit ${provider.name}` : "Provider not found";
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
