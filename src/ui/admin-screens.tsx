import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { Provider } from "@/domain";

import type { AdminScreen } from "./admin";
import { AdminCatalogue, AdminLogin } from "./admin-catalogue";
import type { AdminState } from "./admin-data";
import { ProviderForm } from "./provider-admin";

function SignOut({ state }: { state: AdminState }) {
  const logout = useCallback(() => {
    void state.run("/api/admin/logout");
  }, [state]);
  return (
    <button className="plain-button" disabled={state.pending} type="button" onClick={logout}>
      Sign out
    </button>
  );
}

function ProviderEditor({ state, providerId }: { state: AdminState; providerId: string }) {
  const provider = state.providers.find((entry) => entry.id === providerId);
  const toggle = useCallback(() => {
    if (provider) {
      void state.run("/api/admin/providers/state", { active: !provider.active, id: provider.id });
    }
  }, [provider, state]);
  return (
    <>
      <div className="admin-heading">
        <Link to="/admin">All providers</Link>
        <SignOut state={state} />
      </div>
      {provider ? (
        <>
          <AdminCatalogue state={state} selectedProvider={provider} />
          <details className="admin-panel admin-settings">
            <summary>Provider settings</summary>
            <ProviderForm provider={provider} state={state} key={provider.id} />
            <p className="admin-help">
              Archiving a provider hides it from new reports. Existing reports are kept.
            </p>
            <button
              id={`provider-state-${provider.id}`}
              className="plain-button"
              type="button"
              disabled={state.pending}
              onClick={toggle}
            >
              {provider.active ? "Archive" : "Reactivate"} provider {provider.name}
            </button>
          </details>
        </>
      ) : (
        <section className="admin-panel">
          <p>Provider not found. Check the link or return to all providers.</p>
        </section>
      )}
    </>
  );
}

function ProviderListRow({ provider }: { provider: Provider }) {
  const params = useMemo(() => ({ provider: provider.id }), [provider.id]);
  return (
    <li>
      <div className="admin-provider-summary">
        <span>
          <b>{provider.name}</b>
          <small>{provider.active ? "Active" : "Archived"}</small>
        </span>
        <Link
          className="plain-button"
          aria-label={`Edit ${provider.name}`}
          to="/admin/providers/$provider"
          params={params}
        >
          Edit
        </Link>
      </div>
    </li>
  );
}

function ProviderList({ state }: { state: AdminState }) {
  const providers = useMemo(
    () =>
      state.providers.toSorted(
        (left, right) =>
          left.name.localeCompare(right.name, "en") || left.id.localeCompare(right.id),
      ),
    [state.providers],
  );
  return (
    <section className="admin-panel" aria-labelledby="providers-title">
      <div className="admin-heading">
        <h2 id="providers-title">Provider catalogue</h2>
        <SignOut state={state} />
      </div>
      <p>Choose a provider to edit its details and manage its models.</p>
      <Link className="plain-button" to="/admin/providers/new">
        Add provider
      </Link>
      <ul className="admin-providers">
        {providers.map((provider) => (
          <ProviderListRow key={provider.id} provider={provider} />
        ))}
      </ul>
    </section>
  );
}

function ProviderCreation({ state }: { state: AdminState }) {
  const navigate = useNavigate();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const created = useCallback(
    (provider: Provider) => {
      if (mounted.current) {
        void navigate({
          params: { provider: provider.id },
          state: { savedProvider: provider },
          to: "/admin/providers/$provider",
        });
      }
    },
    [navigate],
  );
  return (
    <>
      <div className="admin-heading">
        <Link to="/admin">All providers</Link>
        <SignOut state={state} />
      </div>
      <section className="admin-panel">
        <h2>Provider details</h2>
        <ProviderForm state={state} onCreated={created} />
      </section>
    </>
  );
}

function AdminScreens({ state, screen }: { state: AdminState; screen: AdminScreen }) {
  if (!state.models) {
    return <AdminLogin state={state} />;
  }
  switch (screen.kind) {
    case "edit": {
      return <ProviderEditor state={state} providerId={screen.providerId} />;
    }
    case "new": {
      return <ProviderCreation state={state} />;
    }
    case "list": {
      return <ProviderList state={state} />;
    }
  }
}

export { AdminScreens };
