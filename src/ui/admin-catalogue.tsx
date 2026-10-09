import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, SubmitEvent } from "react";

import type { Provider } from "@/domain";

import type { AdminState } from "./admin-data";
import { AdminModel } from "./admin-model";

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
  const ids = useMemo(() => models.map((model) => model.id), [models]);
  return (
    <section className="admin-panel" aria-labelledby="catalogue-title">
      <div className="admin-heading">
        <h2 id="catalogue-title">Model catalogue</h2>
      </div>
      <form className="admin-add-model" onSubmit={submit}>
        <label htmlFor="admin-model">Add a model</label>
        <div className="admin-add-model-fields">
          <input
            id="admin-model"
            aria-label="Model name"
            value={name}
            maxLength={120}
            required
            disabled={state.pending}
            onChange={changeName}
          />
          <button
            id="admin-add-model"
            className="plain-button"
            type="submit"
            disabled={state.pending || !name.trim()}
          >
            Add model
          </button>
        </div>
      </form>
      <p className="admin-help">
        Archived models stay in existing reports but cannot be selected for new reports.
      </p>
      {models.length === 0 ? (
        <p>No models for this provider.</p>
      ) : (
        <ul className="admin-models">
          {models.map((model, index) => (
            <AdminModel key={model.id} model={model} ids={ids} index={index} state={state} />
          ))}
        </ul>
      )}
    </section>
  );
}

export { AdminCatalogue, AdminLogin };
