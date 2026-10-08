import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState, useCallback } from "react";

import type { Category, ProviderId } from "@/domain";

import { requestJson, RequestError } from "./data";
import { reportingWindowDelay } from "./report-window";
import { loadTurnstile, mountWidget } from "./turnstile";
import type { Turnstile } from "./turnstile";

interface Session {
  category: Category | null;
  siteKey: string;
  window: number;
}

type ReportState = ReturnType<typeof useReportState>;
function useReportWindow(id: ProviderId, state: ReportState) {
  const { session, pending, setSession, setReportError } = state;
  const reloadSession = useEffectEvent(async () => {
    const next = await requestJson<Session>(`/api/session/${id}`);
    if (!Number.isFinite(next.window)) {
      throw new TypeError("Could not load the reporting window. Please try again.");
    }
    setSession(next);
  });
  const refreshWindow = useEffectEvent(async () => {
    try {
      await reloadSession();
    } catch (error) {
      setReportError(
        error instanceof Error ? error.message : "Could not refresh your reporting window.",
      );
    }
  });

  useEffect(() => {
    if (!session || pending) {
      return;
    }
    const delay = reportingWindowDelay(session.window, Date.now());
    const timer = globalThis.setTimeout(() => {
      void refreshWindow();
    }, delay);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [session, pending]);
}

function useReportVerification(id: ProviderId, state: ReportState) {
  const { container, widget, setSession, setReportError, setToken, attempt } = state;
  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const next = await requestJson<Session>(`/api/session/${id}`);
        if (!active) {
          return;
        }
        if (!Number.isFinite(next.window)) {
          setReportError("Could not load the reporting window. Please try again.");
          return;
        }
        setReportError("");
        setSession(next);
        if (!next.siteKey) {
          setReportError("Reporting is unavailable until verification is configured.");
          return;
        }
        const api = await loadTurnstile();
        if (!active || !container.current) {
          return;
        }
        mountWidget(api, container.current, next.siteKey, widget, setToken, setReportError);
      } catch (error) {
        if (active) {
          setReportError(error instanceof Error ? error.message : "Could not load your report.");
        }
      }
    }
    void initialize();
    return () => {
      active = false;
      if (widget.current) {
        widget.current.api.remove(widget.current.id);
      }
      widget.current = undefined;
    };
    // Retrying recreates the widget even though the provider has not changed.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [id, attempt, container, widget, setSession, setReportError, setToken]);
}

function useReportState() {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: Turnstile; id: string } | undefined>(undefined);
  const [session, setSession] = useState<Session>();
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [reportError, setReportError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [attempt, setAttempt] = useState(0);

  return {
    attempt,
    container,
    feedback,
    pending,
    reportError,
    session,
    setAttempt,
    setFeedback,
    setPending,
    setReportError,
    setSession,
    setToken,
    token,
    widget,
  };
}

async function handleReportError(
  error: unknown,
  id: ProviderId,
  setSession: ReportState["setSession"],
  setReportError: ReportState["setReportError"],
) {
  if (error instanceof RequestError && error.status === 409) {
    try {
      const refreshedSession = await requestJson<Session>(`/api/session/${id}`);
      if (Number.isFinite(refreshedSession.window)) {
        setSession(refreshedSession);
        setReportError(
          "The reporting window changed. Your selection was refreshed. Please submit again.",
        );
      } else {
        setReportError("Invalid reporting window. Please reload the page.");
      }
    } catch {
      setReportError(
        "The reporting window changed, but your selection could not refresh. Please reload the page.",
      );
    }
  } else {
    setReportError(
      error instanceof Error ? error.message : "Could not save your report. Please try again.",
    );
  }
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

function reportCategory(selected: Category | null, category: Category) {
  // The reporting API requires JSON null to undo, not an omitted category.
  // oxlint-disable-next-line unicorn/no-null
  const next = selected === category ? null : category;
  return next;
}

function resetVerification(widget: ReportState["widget"]) {
  if (widget.current) {
    widget.current.api.reset(widget.current.id);
  }
}

function useReportMutation(id: ProviderId, state: ReportState) {
  const router = useRouter();
  const saving = useRef(false);
  const { token, session, setPending, setReportError, setFeedback, setSession, setToken, widget } =
    state;
  return useCallback(
    async (category: Category) => {
      if (!token || !session || saving.current) {
        return;
      }
      saving.current = true;
      const next = reportCategory(session.category, category);
      setPending(true);
      setReportError("");
      setFeedback("");
      try {
        const result = await requestJson<{ category: Category | null }>(`/api/reports/${id}`, {
          body: JSON.stringify({ category: next, token, window: session.window }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        setSession({ ...session, category: result.category });
        setFeedback(
          result.category === null
            ? "Report removed."
            : "Thanks. Your report was recorded. Tap again to undo.",
        );
        await refreshCounts(router, setReportError);
      } catch (error) {
        await handleReportError(error, id, setSession, setReportError);
      }
      setToken("");
      resetVerification(widget);
      setPending(false);
      saving.current = false;
    },
    [
      id,
      token,
      session,
      router,
      setPending,
      setReportError,
      setFeedback,
      setSession,
      setToken,
      widget,
    ],
  );
}

export { useReportState, useReportWindow, useReportVerification, useReportMutation };
export type { ReportState };
