import { useCallback, useEffect, useRef, useState } from "react";

import type { ModelOption, Provider } from "@/domain";

import { parseCatalogue, parseProviders } from "./catalogue-data";
import { requestJson, RequestError } from "./data";

// oxlint-disable-next-line eslint/max-lines-per-function
function useAdmin() {
  const [models, setModels] = useState<ModelOption[]>();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [pending, setPending] = useState(true);
  const [adminError, setAdminError] = useState("");
  const focusId = useRef("");
  useEffect(() => {
    if (!pending && models && focusId.current) {
      document.querySelector<HTMLElement>(`#${CSS.escape(focusId.current)}`)?.focus();
      focusId.current = "";
    }
  }, [models, pending]);
  const read = useCallback(async () => {
    try {
      const [catalogue, providerCatalogue] = await Promise.all([
        requestJson<unknown>("/api/admin/models"),
        requestJson<unknown>("/api/admin/providers"),
      ]);
      const parsedProviders = parseProviders(providerCatalogue);
      setModels(parseCatalogue(catalogue));
      setProviders(parsedProviders);
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
      focusId.current = document.activeElement?.id ?? "";
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
  return { error: adminError, models, pending, providers, run };
}

type AdminState = ReturnType<typeof useAdmin>;

export { useAdmin };
export type { AdminState };
