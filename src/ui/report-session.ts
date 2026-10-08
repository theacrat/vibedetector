import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState, useCallback } from "react";

import type { Category, ProviderId } from "@/domain";

import { requestJson, RequestError } from "./data";
import { reportingWindowDelay } from "./report-window";
import { loadTurnstile, mountWidget } from "./turnstile";

interface Session {
  category: Category | null;
  siteKey: string;
  window: number;
}
interface Intent {
  category: Category | null;
  session: Session;
}
type Phase = "verifying" | "submitting" | "error";
type ReportState = ReturnType<typeof useReportState>;

async function readSession(id: ProviderId, signal?: AbortSignal) {
  const session = await requestJson<Session>(`/api/session/${id}`, signal ? { signal } : undefined);
  if (!Number.isFinite(session.window)) {
    throw new TypeError("Could not load the reporting window. Please try again.");
  }
  return session;
}

function useReportState() {
  // DOM callback refs use null when the dialog unmounts.
  // oxlint-disable-next-line unicorn/no-null
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [session, setSession] = useState<Session>();
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
    session,
    setContainer,
    setFeedback,
    setIntent,
    setPhase,
    setReportError,
    setSession,
  };
}

function useInitialSession(id: ProviderId, state: ReportState) {
  const { setSession, setReportError } = state;
  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      try {
        const next = await readSession(id, controller.signal);
        if (!controller.signal.aborted) {
          setSession(next);
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
  }, [id, setSession, setReportError]);
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
    const timer = globalThis.setTimeout(
      () => {
        void refreshWindow(controller.signal);
      },
      reportingWindowDelay(session.window, Date.now()),
    );
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

// Keep challenge ownership, stale-callback guards and submission cleanup in one effect.
// oxlint-disable-next-line eslint/max-lines-per-function
function useVerification(
  id: ProviderId,
  state: ReportState,
  setControl: (controller: AbortController) => void,
) {
  const router = useRouter();
  const { container, intent, setIntent, setPhase, setSession, setFeedback, setReportError } = state;
  // The challenge and request share one cancellation lifetime.
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
    // One controller owns the widget callbacks and the network write for this intent.
    // oxlint-disable-next-line eslint/max-lines-per-function
    async function submit(token: string) {
      if (controller.signal.aborted || submitted || !token) {
        return;
      }
      submitted = true;
      setPhase("submitting");
      try {
        const result = await requestJson<{ category: Category | null }>(`/api/reports/${id}`, {
          body: JSON.stringify({
            category: staged.category,
            token,
            window: staged.session.window,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        setSession({ ...staged.session, category: result.category });
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
  const { intent, session, setIntent, setPhase, setFeedback, setReportError } = state;
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
      setReportError("");
      setFeedback("");
      setPhase("verifying");
      // JSON null is the API's explicit retraction command.
      // oxlint-disable-next-line unicorn/no-null
      setIntent({ category: session.category === category ? null : category, session });
    },
    [session, intent, setReportError, setFeedback, setPhase, setIntent],
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
