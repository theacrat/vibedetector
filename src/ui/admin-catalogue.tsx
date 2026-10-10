import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, SubmitEvent } from "react";

import type { AdminState } from "./admin-data";

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

export { AdminLogin };
