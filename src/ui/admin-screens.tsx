import { Link } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import type { Provider } from "@/domain";

import { AdminCatalogue, AdminLogin } from "./admin";
import type { AdminState } from "./admin-data";
import { ProviderForm } from "./provider-admin";

function ProviderEditor({ state, providerId }: { state: AdminState; providerId: string }) {
  const provider = state.providers.find((entry) => entry.id === providerId);
  if (!provider) {
    return (
      <section className="admin-panel">
        <p>Provider not found.</p>
        <Link to="/admin">All providers</Link>
      </section>
    );
  }
  return (
    <>
      <Link to="/admin">All providers</Link>
      <section className="admin-panel">
        <h2>Edit {provider.name}</h2>
        <ProviderForm provider={provider} state={state} key={provider.id} />
      </section>
      <AdminCatalogue state={state} selectedProvider={provider} />
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
          <small>{provider.active ? provider.slug : "Archived"}</small>
        </span>
        <Link className="plain-button" to="/admin/providers/$provider" params={params}>
          Edit
        </Link>
      </div>
    </li>
  );
}
function ProviderList({ state }: { state: AdminState }) {
  const logout = useCallback(() => {
    void state.run("/api/admin/logout");
  }, [state]);
  return (
    <section className="admin-panel" aria-labelledby="providers-title">
      <div className="admin-heading">
        <h2 id="providers-title">Providers</h2>
        <button className="plain-button" disabled={state.pending} type="button" onClick={logout}>
          Sign out
        </button>
      </div>
      <p>Choose a provider to edit its details and manage its models.</p>
      <ul className="admin-providers">
        {state.providers.map((provider) => (
          <ProviderListRow key={provider.id} provider={provider} />
        ))}
      </ul>
    </section>
  );
}
function AdminScreens({
  state,
  providerId,
}: {
  state: AdminState;
  providerId: string | undefined;
}) {
  if (!state.models) {return <AdminLogin state={state} />;}
  if (providerId) {return <ProviderEditor state={state} providerId={providerId} />;}
  return <ProviderList state={state} />;
}
export { AdminScreens };
