import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import type { Provider } from "@/domain";

import type { AdminScreen } from "./admin";
import { AdminCatalogue, AdminLogin } from "./admin-catalogue";
import type { AdminState } from "./admin-data";
import { useCatalogueOrder } from "./catalogue-order";
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
          <section className="admin-panel">
            <h2>Provider details</h2>
            <ProviderForm provider={provider} state={state} key={provider.id} />
            <button
              id={`provider-state-${provider.id}`}
              className="plain-button"
              type="button"
              disabled={state.pending}
              onClick={toggle}
            >
              {provider.active ? "Archive" : "Reactivate"} provider {provider.name}
            </button>
          </section>
          <AdminCatalogue state={state} selectedProvider={provider} />
        </>
      ) : (
        <section className="admin-panel">
          <p>Provider not found. Check the link or return to all providers.</p>
        </section>
      )}
    </>
  );
}

// oxlint-disable-next-line eslint/max-lines-per-function
function ProviderListRow({
  provider,
  index,
  state,
}: {
  provider: Provider;
  index: number;
  state: AdminState;
}) {
  const params = useMemo(() => ({ provider: provider.id }), [provider.id]);
  const ids = useMemo(() => state.providers.map((entry) => entry.id), [state.providers]);
  const onOrder = useCallback(
    (order: string[]) => {
      void state.run("/api/admin/providers/order", { ids: order });
    },
    [state],
  );
  const { up, down, moveUp, moveDown } = useCatalogueOrder({
    id: provider.id,
    ids,
    index,
    onOrder,
    pending: state.pending,
  });
  return (
    <li>
      <div className="admin-provider-summary">
        <span>
          <b>{provider.name}</b>
          <small>
            {provider.slug} · {provider.active ? "Active" : "Archived"}
          </small>
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
      <div className="admin-model-actions">
        <button
          className="plain-button"
          type="button"
          ref={up}
          disabled={state.pending || index === 0}
          aria-label={`Move up provider ${provider.name}`}
          onClick={moveUp}
        >
          Move up
        </button>
        <button
          className="plain-button"
          type="button"
          ref={down}
          disabled={state.pending || index === ids.length - 1}
          aria-label={`Move down provider ${provider.name}`}
          onClick={moveDown}
        >
          Move down
        </button>
      </div>
    </li>
  );
}

function ProviderList({ state }: { state: AdminState }) {
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
        {state.providers.map((provider, index) => (
          <ProviderListRow key={provider.id} provider={provider} index={index} state={state} />
        ))}
      </ul>
    </section>
  );
}

function ProviderCreation({ state }: { state: AdminState }) {
  const navigate = useNavigate();
  const created = useCallback(
    (providerId: string) => {
      void navigate({ params: { provider: providerId }, to: "/admin/providers/$provider" });
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
