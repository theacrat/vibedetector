import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState, useCallback } from "react";

import type { Category, ModelOption, ProviderId } from "@/domain";

import { parseCatalogue } from "./catalogue-data";
import { requestJson, RequestError } from "./data";
import { reportingWindowDelay } from "./report-window";
import { loadTurnstile, mountWidget } from "./turnstile";

interface Session {
  models: ModelOption[];
  category: Category | null;
  model: string | null;
  siteKey: string;
  window: number;
}
interface Intent {
  category: Category | null;
  model: string | null;
  session: Session;
}
type Phase = "verifying" | "submitting" | "error";
type ReportState = ReturnType<typeof useReportState>;

async function readSession(id: ProviderId, signal?: AbortSignal) {
  const session = await requestJson<Session>(`/api/session/${id}`, signal ? { signal } : undefined);
  if (!Number.isFinite(session.window)) {
    throw new TypeError("Could not load the reporting window. Please try again.");
  }
  // Older session responses omit optional model metadata.
  // oxlint-disable-next-line unicorn/no-null
  return { ...session, model: session.model ?? null, models: parseCatalogue(session.models ?? []) };
}

function useReportState() {
  // DOM callback refs use null when the dialog unmounts.
  // oxlint-disable-next-line unicorn/no-null
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [session, setSession] = useState<Session>();
  // JSON null represents an unspecified report model.
  // oxlint-disable-next-line unicorn/no-null
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent>();
  const [phase, setPhase] = useState<Phase>("verifying");
  const [reportError, setReportError] = useState("");
  const [feedback, setFeedback] = useState("");
  return {
    container,
    feedback,
    intent,
    pending: intent !== undefined,
    phase,
    reportError,
    selectedModel,
    session,
    setContainer,
    setFeedback,
    setIntent,
    setPhase,
    setReportError,
    setSelectedModel,
    setSession,
  };
}

function useInitialSession(id: ProviderId, state: ReportState) {
  const { setSession, setSelectedModel, setReportError } = state;
  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      try {
        const next = await readSession(id, controller.signal);
        if (!controller.signal.aborted) {
          setSession(next);
          setSelectedModel(next.model);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setReportError(error instanceof Error ? error.message : "Could not load your report.");
        }
      }
    }
    void initialize();
    return () => {
      controller.abort();
    };
  }, [id, setSession, setSelectedModel, setReportError]);
}

function useReportWindow(id: ProviderId, state: ReportState) {
  const { session, pending, setSession, setReportError } = state;
  useInitialSession(id, state);
  const refreshWindow = useEffectEvent(async (signal: AbortSignal) => {
    try {
      const next = await readSession(id, signal);
      if (!signal.aborted && !pending) {
        setSession(next);
      }
    } catch (error) {
      if (!signal.aborted && !pending) {
        setReportError(
          error instanceof Error ? error.message : "Could not refresh your reporting window.",
        );
      }
    }
  });
  useEffect(() => {
    if (!session || pending) {
      return;
    }
    const controller = new AbortController();
    const delay = Math.min(60_000, reportingWindowDelay(session.window, Date.now()));
    const timer = globalThis.setTimeout(() => {
      void refreshWindow(controller.signal);
    }, delay);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [session, pending]);
}

async function refreshCounts(
  router: ReturnType<typeof useRouter>,
  setReportError: ReportState["setReportError"],
) {
  try {
    await router.invalidate();
  } catch {
    setReportError(
      "Your report was saved, but public counts could not refresh. Please refresh the page.",
    );
  }
}

// oxlint-disable-next-line eslint/max-lines-per-function
function useVerification(
  id: ProviderId,
  state: ReportState,
  setControl: (controller: AbortController) => void,
) {
  const router = useRouter();
  const { container, intent, setIntent, setPhase, setSession, setFeedback, setReportError } = state;
  // oxlint-disable-next-line eslint/max-lines-per-function
  useEffect(() => {
    if (!intent || !container) {
      return;
    }
    const controller = new AbortController();
    setControl(controller);
    const staged = intent;
    const element = container;
    let widget: ReturnType<typeof mountWidget> | undefined;
    let submitted = false;
    const fail = (message: string) => {
      if (!controller.signal.aborted && !submitted) {
        setReportError(message);
        setPhase("error");
        controller.abort();
      }
    };
    // oxlint-disable-next-line eslint/max-lines-per-function
    async function submit(token: string) {
      if (controller.signal.aborted || submitted || !token) {
        return;
      }
      submitted = true;
      setPhase("submitting");
      try {
        const result = await requestJson<{ category: Category | null; model?: string | null }>(
          `/api/reports/${id}`,
          {
            body: JSON.stringify({
              category: staged.category,
              ...(staged.model ? { model: staged.model } : {}),
              token,
              window: staged.session.window,
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) {
          return;
        }
        // oxlint-disable-next-line unicorn/no-null
        setSession({ ...staged.session, category: result.category, model: result.model ?? null });
        setFeedback(
          result.category === null
            ? "Report removed."
            : "Thanks. Your report was recorded. Tap again to undo.",
        );
        setIntent(undefined);
        await refreshCounts(router, setReportError);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        let message =
          error instanceof Error ? error.message : "Could not save your report. Please try again.";
        if (error instanceof RequestError && error.status === 409) {
          try {
            const next = await readSession(id, controller.signal);
            if (controller.signal.aborted) {
              return;
            }
            setSession(next);
            message =
              "The reporting window changed. Your selection was refreshed. Please submit again.";
          } catch {
            message =
              "The reporting window changed, but your selection could not refresh. Please reload the page.";
          }
        }
        if (!controller.signal.aborted) {
          setReportError(message);
          setPhase("error");
          controller.abort();
        }
      }
    }
    async function verify() {
      if (!staged.session.siteKey) {
        fail("Reporting is unavailable until verification is configured.");
        return;
      }
      try {
        const api = await loadTurnstile();
        if (!controller.signal.aborted) {
          widget = mountWidget(
            api,
            element,
            staged.session.siteKey,
            (token) => {
              void submit(token);
            },
            fail,
          );
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : "Could not load verification.");
      }
    }
    void verify();
    return () => {
      controller.abort();
      if (widget) {
        widget.api.remove(widget.id);
      }
    };
  }, [
    id,
    container,
    intent,
    setControl,
    router,
    setIntent,
    setPhase,
    setSession,
    setFeedback,
    setReportError,
  ]);
}

function useReportMutation(id: ProviderId, state: ReportState) {
  const control = useRef<AbortController | undefined>(undefined);
  const { intent, session, selectedModel, setIntent, setPhase, setFeedback, setReportError } =
    state;
  const cancel = useCallback(() => {
    control.current?.abort();
    setIntent(undefined);
    setReportError("");
  }, [control, setIntent, setReportError]);
  const stage = useCallback(
    (category: Category) => {
      if (!session || intent) {
        return;
      }
      const retracting = session.category === category && session.model === selectedModel;
      if (
        !retracting &&
        selectedModel &&
        !session.models.some((model) => model.name === selectedModel && model.active)
      ) {
        setReportError("This model is archived. Choose an active model for a new report.");
        return;
      }
      setReportError("");
      setFeedback("");
      setPhase("verifying");
      // JSON null is the API's explicit retraction command.
      setIntent({
        category:
          // oxlint-disable-next-line unicorn/no-null
          retracting ? null : category,
        model: selectedModel,
        session,
      });
    },
    [session, intent, selectedModel, setReportError, setFeedback, setPhase, setIntent],
  );
  const retry = useCallback(() => {
    control.current?.abort();
    if (intent && session) {
      setReportError("");
      setPhase("verifying");
      setIntent({ ...intent, session });
    }
  }, [control, intent, session, setReportError, setPhase, setIntent]);

  const setControl = useCallback((controller: AbortController) => {
    control.current = controller;
  }, []);
  useVerification(id, state, setControl);
  return { cancel, retry, stage };
}

export { useReportState, useReportWindow, useReportMutation };
export type { ReportState };
