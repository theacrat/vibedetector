import { useCallback, useEffect, useRef } from "react";
import type { SubmitEvent } from "react";

import type { Provider } from "@/domain";

import type { AdminState } from "./admin-data";

const providerFields = [
  { label: "Provider name", name: "name", required: true },
  { label: "URL slug", name: "slug", required: true },
  { label: "Maker", name: "maker", required: true },
  { label: "Official status URL", name: "status", required: true },
  { label: "Status link label", name: "statusLabel", required: true },
  { label: "Logo path or HTTPS URL", name: "logo", required: false },
] as const;

// oxlint-disable-next-line eslint/max-lines-per-function
function ProviderForm({ provider, state }: { provider?: Provider; state: AdminState }) {
  const prefix = provider?.id ?? "new-provider";
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const displayFields = Object.fromEntries(
        providerFields.map(({ name }) => {
          const value = fields.get(name);
          return [name, typeof value === "string" ? value.trim() : ""];
        }),
      );
      void state.run(provider ? "/api/admin/providers/update" : "/api/admin/providers", {
        ...displayFields,
        ...(provider ? { id: provider.id } : {}),
      });
    },
    [provider, state],
  );
  return (
    <form onSubmit={submit} className="admin-provider-form">
      {provider && (
        <p className="admin-id">
          Provider ID <code>{provider.id}</code>
        </p>
      )}
      {providerFields.map(({ name, label, required }) => (
        <div key={name}>
          <label htmlFor={`${prefix}-${name}`}>{label}</label>
          <input
            id={`${prefix}-${name}`}
            name={name}
            defaultValue={provider?.[name] ?? ""}
            required={required}
            disabled={state.pending}
            maxLength={name === "status" || name === "logo" ? 2048 : 120}
            pattern={name === "slug" ? "[a-z0-9]+(-[a-z0-9]+)*" : undefined}
            type={name === "status" ? "url" : "text"}
          />
        </div>
      ))}
      <p>
        Names do not change URLs. Changing the URL slug stops old links from working. Use lowercase
        letters, numbers and hyphens.
      </p>
      <p>Status links must use HTTPS. Logos must use a controlled local path or HTTPS URL.</p>
      <button id={`${prefix}-save`} className="plain-button" type="submit" disabled={state.pending}>
        {provider ? "Save provider" : "Add provider"}
      </button>
    </form>
  );
}

// oxlint-disable-next-line eslint/max-lines-per-function
function ProviderRow({
  provider,
  index,
  state,
}: {
  provider: Provider;
  index: number;
  state: AdminState;
}) {
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const moved = useRef<"up" | "down" | undefined>(undefined);
  useEffect(() => {
    if (!state.pending && moved.current) {
      const preferred = moved.current === "up" ? up.current : down.current;
      const alternative = moved.current === "up" ? down.current : up.current;
      (preferred?.disabled ? alternative : preferred)?.focus();
      moved.current = undefined;
    }
  }, [state.pending]);
  const move = useCallback(
    (direction: "up" | "down") => {
      const ids = state.providers.map((entry) => entry.id);
      const adjacent = index + (direction === "up" ? -1 : 1);
      const neighbour = ids[adjacent];
      if (state.pending || neighbour === undefined) {
        return;
      }
      ids[adjacent] = provider.id;
      ids[index] = neighbour;
      moved.current = direction;
      void state.run("/api/admin/providers/order", { ids });
    },
    [index, provider.id, state],
  );
  const moveUp = useCallback(() => {
    move("up");
  }, [move]);
  const moveDown = useCallback(() => {
    move("down");
  }, [move]);
  const toggle = useCallback(() => {
    void state.run("/api/admin/providers/state", { active: !provider.active, id: provider.id });
  }, [provider.id, provider.active, state]);
  return (
    <li>
      <div className="admin-heading">
        <b>{provider.name}</b>
        <small>{provider.active ? "Active" : "Archived"}</small>
      </div>
      <details>
        <summary>Edit {provider.name}</summary>
        <ProviderForm
          provider={provider}
          state={state}
          key={`${provider.id}-${provider.name}-${provider.slug}-${provider.maker}-${provider.status}-${provider.statusLabel}-${provider.logo}`}
        />
      </details>
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
          disabled={state.pending || index === state.providers.length - 1}
          aria-label={`Move down provider ${provider.name}`}
          onClick={moveDown}
        >
          Move down
        </button>
        <button
          className="plain-button"
          type="button"
          disabled={state.pending}
          aria-label={`${provider.active ? "Archive" : "Reactivate"} provider ${provider.name}`}
          onClick={toggle}
        >
          {provider.active ? "Archive" : "Reactivate"}
        </button>
      </div>
    </li>
  );
}

function ProviderAdmin({ state }: { state: AdminState }) {
  return (
    <section className="admin-panel" aria-labelledby="providers-title">
      <h2 id="providers-title">Provider catalogue</h2>
      <p>
        Archive providers to hide their pages and stop reports. Restore the provider before its
        models can accept reports again. History is retained.
      </p>
      <details>
        <summary>Add a provider</summary>
        <ProviderForm state={state} />
      </details>
      <ul className="admin-providers">
        {state.providers.map((provider, index) => (
          <ProviderRow provider={provider} index={index} state={state} key={provider.id} />
        ))}
      </ul>
    </section>
  );
}

export { ProviderAdmin };
