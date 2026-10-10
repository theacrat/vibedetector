import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AdminScreen } from "./admin";
import { AdminLogin } from "./admin-catalogue";
import type { AdminState } from "./admin-data";
import { requestJson } from "./data";

interface SyncStatus {
  provider: string;
  scope: string;
  succeededAt: number;
  modelCount: number;
  status: string;
  pending: boolean;
}

function parseSyncStatuses(value: unknown): SyncStatus[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid sync status");
  }
  return value.map((row: unknown) => {
    if (
      !row ||
      typeof row !== "object" ||
      !("provider" in row) ||
      typeof row.provider !== "string" ||
      !("scope" in row) ||
      typeof row.scope !== "string" ||
      !("succeededAt" in row) ||
      typeof row.succeededAt !== "number" ||
      !("modelCount" in row) ||
      typeof row.modelCount !== "number" ||
      !("status" in row) ||
      typeof row.status !== "string" ||
      !("pending" in row) ||
      typeof row.pending !== "boolean"
    ) {
      throw new TypeError("Invalid sync status");
    }
    return {
      modelCount: row.modelCount,
      pending: row.pending,
      provider: row.provider,
      scope: row.scope,
      status: row.status,
      succeededAt: row.succeededAt,
    };
  });
}

function SyncRow({
  status,
  state,
  expanded,
}: {
  status: SyncStatus;
  state: AdminState;
  expanded: boolean;
}) {
  const params = useMemo(() => ({ provider: status.provider }), [status.provider]);
  const provider = state.providers.find((entry) => entry.id === status.provider);
  return (
    <li>
      <h3>{provider?.name ?? "Provider"}</h3>
      <p>{status.scope}</p>
      <p>{status.pending ? "Syncing" : status.status}</p>
      <p>
        Last success: {status.succeededAt ? new Date(status.succeededAt).toLocaleString() : "Never"}
        . Models: {status.modelCount}.
      </p>
      <Link to="/admin/providers/$provider" params={params}>
        View catalogue
      </Link>
      {expanded && (
        <ul>
          {state.models
            ?.filter((model) => model.provider === status.provider)
            .map((model) => (
              <li key={model.id}>
                {model.name}
                {model.active ? "" : " (archived)"}
              </li>
            ))}
        </ul>
      )}
    </li>
  );
}

function useSyncStatus(pending: boolean) {
  const [statuses, setStatuses] = useState<SyncStatus[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (pending) {
      return;
    }
    let mounted = true;
    async function load() {
      try {
        const result = parseSyncStatuses(await requestJson<unknown>("/api/admin/sync"));
        if (mounted) {
          setStatuses(result);
          setError("");
        }
      } catch {
        if (mounted) {
          setError("Could not load sync status.");
        }
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [pending]);
  return { error, statuses };
}

function SyncPanel({ state, providerId }: { state: AdminState; providerId: string | undefined }) {
  const { error, statuses } = useSyncStatus(state.pending);
  const refresh = useCallback(() => {
    void state.run("/api/admin/sync", providerId ? { provider: providerId } : {});
  }, [providerId, state]);
  const logout = useCallback(() => {
    void state.run("/api/admin/logout");
  }, [state]);
  const refreshLabel = providerId ? "Refresh provider" : "Refresh all providers";
  return (
    <section className="admin-panel" aria-labelledby="catalogue-title">
      <div className="admin-heading">
        <h2 id="catalogue-title">Catalogue sync</h2>
        <button className="plain-button" type="button" disabled={state.pending} onClick={logout}>
          Sign out
        </button>
      </div>
      <p>Official API-discovered models. These are not exhaustive consumer product catalogues.</p>
      {providerId && <Link to="/admin">All providers</Link>}
      <button className="plain-button" type="button" disabled={state.pending} onClick={refresh}>
        {state.pending ? "Refreshing..." : refreshLabel}
      </button>
      {error && <p role="alert">{error}</p>}
      <ul className="admin-providers">
        {statuses
          .filter((status) => !providerId || status.provider === providerId)
          .map((status) => (
            <SyncRow
              key={status.provider}
              status={status}
              state={state}
              expanded={Boolean(providerId)}
            />
          ))}
      </ul>
    </section>
  );
}

function AdminScreens({ state, screen }: { state: AdminState; screen: AdminScreen }) {
  if (!state.models) {
    return <AdminLogin state={state} />;
  }
  return (
    <SyncPanel state={state} providerId={screen.kind === "edit" ? screen.providerId : undefined} />
  );
}

export { AdminScreens };
