import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, SubmitEvent } from "react";

import type { ModelOption, Provider } from "@/domain";

import type { AdminState } from "./admin-data";
import { useCatalogueOrder } from "./catalogue-order";

function ModelRename({ model, state }: { model: ModelOption; state: AdminState }) {
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const name = fields.get("name");
      if (typeof name !== "string") {
        return;
      }
      void state.run("/api/admin/models/update", {
        id: model.id,
        name: name.trim(),
      });
    },
    [model.id, state],
  );
  return (
    <form onSubmit={submit} className="admin-rename" key={model.name}>
      <label htmlFor={`model-name-${model.id}`}>Rename {model.name}</label>
      <input
        id={`model-name-${model.id}`}
        name="name"
        defaultValue={model.name}
        maxLength={120}
        required
        disabled={state.pending}
      />
      <button
        id={`model-save-${model.id}`}
        className="plain-button"
        type="submit"
        disabled={state.pending}
      >
        Save model name
      </button>
    </form>
  );
}

function AdminLogin({ state }: { state: AdminState }) {
  const [key, setKey] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!state.pending) {
      input.current?.focus();
    }
  }, [state.pending]);
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      const submittedKey = key;
      setKey("");
      void state.run("/api/admin/login", { key: submittedKey });
    },
    [key, state],
  );
  const changeKey = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setKey(event.currentTarget.value);
  }, []);
  return (
    <form className="admin-panel" onSubmit={submit}>
      <h2>Sign in</h2>
      <p>Use your administrator key. It is not saved in this browser.</p>
      <label htmlFor="admin-key">Administrator key</label>
      <input
        id="admin-key"
        ref={input}
        type="password"
        value={key}
        autoComplete="off"
        required
        disabled={state.pending}
        onChange={changeKey}
      />
      <button className="plain-button" type="submit" disabled={state.pending}>
        {state.pending ? "Connecting..." : "Sign in"}
      </button>
    </form>
  );
}

// oxlint-disable-next-line eslint/max-lines-per-function
function AdminCatalogue({
  state,
  selectedProvider,
}: {
  state: AdminState;
  selectedProvider: Provider;
}) {
  const provider = selectedProvider.id;
  const [name, setName] = useState("");
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      void state.run("/api/admin/models", { name: name.trim(), provider });
    },
    [name, provider, state],
  );
  const changeName = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.currentTarget.value);
  }, []);
  const models = useMemo(
    () => state.models?.filter((model) => model.provider === provider) ?? [],
    [provider, state.models],
  );
  return (
    <section className="admin-panel" aria-labelledby="catalogue-title">
      <div className="admin-heading">
        <h2 id="catalogue-title">Model catalogue</h2>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="admin-model">Model name</label>
        <input
          id="admin-model"
          value={name}
          maxLength={120}
          required
          disabled={state.pending}
          onChange={changeName}
        />
        <button className="plain-button" type="submit" disabled={state.pending || !name.trim()}>
          Add model
        </button>
      </form>
      <p>
        Names can change without changing reports or shared model filters. Archive models to stop
        new reports without losing their history.
      </p>
      {models.length === 0 ? (
        <p>No models for this provider.</p>
      ) : (
        <ul className="admin-models">
          {models.map((model, index) => (
            // oxlint-disable-next-line eslint/no-use-before-define
            <AdminModel key={model.id} model={model} models={models} index={index} state={state} />
          ))}
        </ul>
      )}
    </section>
  );
}

// oxlint-disable-next-line eslint/max-lines-per-function
function AdminModel({
  model,
  models,
  index,
  state,
}: {
  model: ModelOption;
  models: ModelOption[];
  index: number;
  state: AdminState;
}) {
  const ids = models.map((entry) => entry.id);
  const onOrder = useCallback(
    (order: string[]) => {
      void state.run("/api/admin/models/order", { ids: order, provider: model.provider });
    },
    [model.provider, state],
  );
  const { up, down, moveUp, moveDown } = useCatalogueOrder({
    id: model.id,
    ids,
    index,
    onOrder,
    pending: state.pending,
  });
  const toggle = useCallback(() => {
    void state.run("/api/admin/models/state", { active: !model.active, id: model.id });
  }, [model, state]);
  return (
    <li>
      <span>
        <b>{model.name}</b>
        <small>{model.active ? "Active" : "Archived"}</small>
        <details className="admin-id">
          <summary>Model ID</summary>
          <code>{model.id}</code>
        </details>
      </span>
      <ModelRename model={model} state={state} />
      <div className="admin-model-actions">
        <button
          className="plain-button"
          ref={up}
          type="button"
          disabled={state.pending || index === 0}
          aria-label={`Move up ${model.name}`}
          onClick={moveUp}
        >
          Move up
        </button>
        <button
          className="plain-button"
          ref={down}
          type="button"
          disabled={state.pending || index === models.length - 1}
          aria-label={`Move down ${model.name}`}
          onClick={moveDown}
        >
          Move down
        </button>
        <button
          className="plain-button"
          id={`model-state-${model.id}`}
          type="button"
          disabled={state.pending}
          aria-label={`${model.active ? "Archive" : "Reactivate"} ${model.name}`}
          onClick={toggle}
        >
          {model.active ? "Archive" : "Reactivate"}
        </button>
      </div>
    </li>
  );
}

export { AdminCatalogue, AdminLogin };
