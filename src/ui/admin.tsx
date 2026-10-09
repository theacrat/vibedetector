import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, SubmitEvent } from "react";

import { providers } from "@/domain";
import type { ModelOption } from "@/domain";

import { parseCatalogue } from "./catalogue-data";
import { requestJson, RequestError } from "./data";

import "./admin.css";

// oxlint-disable-next-line eslint/max-lines-per-function
function useAdmin() {
  const [models, setModels] = useState<ModelOption[]>();
  const [pending, setPending] = useState(true);
  const [adminError, setAdminError] = useState("");
  const read = useCallback(async () => {
    try {
      const catalogue = await requestJson<unknown>("/api/admin/models");
      setModels(parseCatalogue(catalogue));
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) {
        setModels(undefined);
      } else {
        throw error;
      }
    }
  }, []);
  const run = useCallback(
    async (path?: string, body?: object) => {
      setPending(true);
      setAdminError("");
      try {
        if (path) {
          await requestJson<unknown>(path, {
            body: JSON.stringify(body ?? {}),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });
        }
        if (path === "/api/admin/logout") {
          setModels(undefined);
        } else {
          await read();
        }
      } catch (error) {
        if (error instanceof RequestError && error.status === 401) {
          setModels(undefined);
        }
        setAdminError(error instanceof Error ? error.message : "Could not update the catalogue.");
      }
      setPending(false);
    },
    [read],
  );
  useEffect(() => {
    async function initialize() {
      try {
        await read();
      } catch (error) {
        setAdminError(error instanceof Error ? error.message : "Could not load the catalogue.");
      }
      setPending(false);
    }
    void initialize();
  }, [read]);
  return { error: adminError, models, pending, run };
}

type AdminState = ReturnType<typeof useAdmin>;

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
function AdminCatalogue({ state }: { state: AdminState }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const [provider, setProvider] = useState<string>(providers[0].id);
  const [name, setName] = useState("");
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      void state.run("/api/admin/models", { name: name.trim(), provider });
    },
    [name, provider, state],
  );
  const changeProvider = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setProvider(event.currentTarget.value);
  }, []);
  const changeName = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.currentTarget.value);
  }, []);
  const logout = useCallback(() => {
    void state.run("/api/admin/logout");
  }, [state]);
  const models = useMemo(
    () => state.models?.filter((model) => model.provider === provider) ?? [],
    [provider, state.models],
  );
  return (
    <section className="admin-panel" aria-labelledby="catalogue-title">
      <div className="admin-heading">
        <h2 id="catalogue-title" ref={heading} tabIndex={-1}>
          Model catalogue
        </h2>
        <button className="plain-button" disabled={state.pending} type="button" onClick={logout}>
          Sign out
        </button>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="admin-provider">Provider</label>
        <select
          id="admin-provider"
          value={provider}
          disabled={state.pending}
          onChange={changeProvider}
        >
          {providers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
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
      <p>Names are permanent. Archive models to stop new reports without losing their history.</p>
      {models.length === 0 ? (
        <p>No models for this provider.</p>
      ) : (
        <ul className="admin-models">
          {models.map((model, index) => (
            // oxlint-disable-next-line eslint/no-use-before-define
            <AdminModel
              key={model.name}
              model={model}
              models={models}
              index={index}
              state={state}
            />
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
      const names = models.map((entry) => entry.name);
      const adjacent = index + (direction === "up" ? -1 : 1);
      const neighbour = names[adjacent];
      if (state.pending || neighbour === undefined) {
        return;
      }
      names[adjacent] = model.name;
      names[index] = neighbour;
      moved.current = direction;
      void state.run("/api/admin/models/order", { names, provider: model.provider });
    },
    [index, model, models, state],
  );
  const moveUp = useCallback(() => {
    move("up");
  }, [move]);
  const moveDown = useCallback(() => {
    move("down");
  }, [move]);
  const toggle = useCallback(() => {
    void state.run("/api/admin/models/state", { ...model, active: !model.active });
  }, [model, state]);
  return (
    <li>
      <span>
        <b>{model.name}</b>
        <small>{model.active ? "Active" : "Archived"}</small>
      </span>
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

function ModelAdmin() {
  const state = useAdmin();
  return (
    <main className="wrap admin" id="main">
      <p className="maker">Administration</p>
      <h1>Keep the model list current.</h1>
      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.pending && <output>Loading catalogue...</output>}
      {state.models ? <AdminCatalogue state={state} /> : <AdminLogin state={state} />}
    </main>
  );
}

export { ModelAdmin };
