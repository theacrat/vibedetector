import { useCallback } from "react";
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
function ProviderForm({
  provider,
  state,
  onCreated,
}: {
  provider?: Provider;
  state: AdminState;
  onCreated?: (provider: Provider) => void;
}) {
  const prefix = provider?.id ?? "new-provider";
  const save = useCallback(
    async (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const displayFields = Object.fromEntries(
        providerFields.map(({ name }) => {
          const value = fields.get(name);
          return [name, typeof value === "string" ? value.trim() : ""];
        }),
      );
      const catalogue = await state.run(
        provider ? "/api/admin/providers/update" : "/api/admin/providers",
        {
          ...displayFields,
          ...(provider ? { id: provider.id } : {}),
        },
      );
      if (!provider && catalogue && catalogue.every((entry) => "slug" in entry)) {
        const created = catalogue.find(
          (entry) =>
            entry.slug === displayFields["slug"] &&
            !state.providers.some((previous) => previous.id === entry.id),
        );
        if (created) {
          onCreated?.(created);
        }
      }
    },
    [onCreated, provider, state],
  );
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      void save(event);
    },
    [save],
  );
  return (
    <form onSubmit={submit} className="admin-provider-form">
      {provider && (
        <details className="admin-id">
          <summary>Provider ID</summary>
          <code>{provider.id}</code>
        </details>
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

export { ProviderForm };
