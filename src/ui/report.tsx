import { useRouter } from "@tanstack/react-router";
import { Funnel, Hourglass, Zap } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, useCallback } from "react";
import { Button } from "react-aria-components";

import { categories } from "@/domain";
import type { Category, ProviderId } from "@/domain";

import { requestJson, RequestError } from "./data";

interface Turnstile {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}
function turnstileApi() {
  const browser = globalThis as typeof globalThis & { turnstile?: Turnstile };
  return browser.turnstile;
}

let turnstileScript: Promise<Turnstile> | undefined;
async function loadTurnstile() {
  const existing = turnstileApi();
  if (existing) {
    return existing;
  }
  // Script load events have no promise API. Adapt them once for all widget consumers.
  // oxlint-disable-next-line promise/avoid-new
  turnstileScript ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.addEventListener(
      "load",
      () => {
        const api = turnstileApi();
        if (!api) {
          reject(new Error("Verification did not load. Please try again."));
          return;
        }
        resolve(api);
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        script.remove();
        turnstileScript = undefined;
        reject(new Error("Could not load verification. Please check your connection."));
      },
      { once: true },
    );
    // Worker runtime types overload append for streaming HTML; appendChild is the DOM API.
    // oxlint-disable-next-line unicorn/prefer-dom-node-append
    document.head.appendChild(script);
  });
  return turnstileScript;
}

const icons = { broken: Zap, nerfed: Funnel, slow: Hourglass };
interface Session {
  category: Category | null;
  siteKey: string;
  window: number;
}

export function Report({ id }: { id: ProviderId }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: Turnstile; id: string } | undefined>(undefined);
  const saving = useRef(false);
  const [session, setSession] = useState<Session>();
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [reportError, setReportError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [attempt, setAttempt] = useState(0);

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
    const delay = Math.max(0, session.window + 3_600_000 - Date.now());
    const timer = globalThis.setTimeout(() => {
      void refreshWindow();
    }, delay);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [session, pending]);

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
        widget.current = {
          api,
          id: api.render(container.current, {
            action: "report",
            callback: setToken,
            "error-callback": () => {
              setToken("");
              setReportError("Verification failed. Please retry verification.");
            },
            "expired-callback": () => {
              setToken("");
            },
            sitekey: next.siteKey,
          }),
        };
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
    // Retrying recreates the failed explicit widget even when the provider has not changed.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [id, attempt]);

  const report = useCallback(
    async (category: Category) => {
      if (!token || !session || saving.current) {
        return;
      }
      saving.current = true;
      // The reporting API requires JSON null to undo, not an omitted category.
      // oxlint-disable-next-line unicorn/no-null
      const next = session.category === category ? null : category;
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
        try {
          await router.invalidate();
        } catch {
          setReportError(
            "Your report was saved, but public counts could not refresh. Please refresh the page.",
          );
        }
      } catch (error) {
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
            error instanceof Error
              ? error.message
              : "Could not save your report. Please try again.",
          );
        }
      }
      setToken("");
      if (widget.current) {
        widget.current.api.reset(widget.current.id);
      }
      setPending(false);
      saving.current = false;
    },
    [id, token, session, router],
  );

  const reportActions = useCallback(
    (category: Category) => () => {
      void report(category);
    },
    [report],
  );
  const retryVerification = useCallback(() => {
    setToken("");
    setAttempt((value) => value + 1);
  }, []);

  return (
    <section className="report" aria-labelledby="feels">
      <h2 id="feels">My AI feels...</h2>
      <fieldset className={`btns${session?.category ? " done" : ""}`} aria-label="Report an issue">
        {categories.map((category) => {
          const Icon = icons[category];
          return (
            <Button
              key={category}
              className={`vibe-btn ${category}`}
              aria-pressed={session?.category === category}
              isDisabled={pending || !session || !token}
              onPress={reportActions(category)}
            >
              <Icon aria-hidden="true" />
              <span>{category}</span>
            </Button>
          );
        })}
      </fieldset>
      <output className="hint">
        {pending
          ? "Saving your report..."
          : feedback ||
            (session?.category
              ? "Your report is selected. Tap again to undo."
              : "One report per AI per hour. Switch or undo anytime.")}
      </output>
      <div className="verification" ref={container} />
      {reportError && (
        <div className="error" role="alert">
          <p>{reportError}</p>
          <Button className="plain-button" isDisabled={pending} onPress={retryVerification}>
            Retry verification
          </Button>
        </div>
      )}
    </section>
  );
}
