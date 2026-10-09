import { isCategory, isId } from "@/domain";
import type { ProviderId } from "@/domain";

import { parseCatalogue } from "./catalogue-data";
import { requestJson } from "./data";
import type { Session } from "./report-session";

async function readSession(id: ProviderId, signal?: AbortSignal): Promise<Session> {
  const session = await requestJson<unknown>(`/api/session/${id}`, signal ? { signal } : undefined);
  if (
    typeof session !== "object" ||
    session === null ||
    !("window" in session) ||
    typeof session.window !== "number" ||
    !Number.isSafeInteger(session.window) ||
    !("model" in session) ||
    (session.model !== null && !isId(session.model)) ||
    !("category" in session) ||
    (session.category !== null && !isCategory(session.category)) ||
    !("siteKey" in session) ||
    typeof session.siteKey !== "string" ||
    !("models" in session)
  ) {
    throw new TypeError("Could not load the reporting window. Please try again.");
  }
  const models = parseCatalogue(session.models);
  if (models.some((model) => model.provider !== id)) {
    throw new TypeError("Could not load the model catalogue. Please try again.");
  }
  return {
    category: session.category,
    model: session.model,
    models,
    siteKey: session.siteKey,
    window: session.window,
  };
}

export { readSession };
