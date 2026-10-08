import { useRouter } from "@tanstack/react-router";
import { Funnel, Hourglass, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";

import { categories, type Category, type ProviderId } from "@/domain";

import { requestJson } from "./data";

type Turnstile = {
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
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let turnstileScript: Promise<Turnstile> | undefined;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileScript) {
    turnstileScript = new Promise<Turnstile>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () =>
        window.turnstile
          ? resolve(window.turnstile)
          : reject(new Error("Verification did not load. Please try again."));
      script.onerror = () => {
        script.remove();
        turnstileScript = undefined;
        reject(new Error("Could not load verification. Please check your connection."));
      };
      document.head.appendChild(script);
    });
  }
  return turnstileScript;
}

const icons = { nerfed: Funnel, slow: Hourglass, broken: Zap };
type Session = { category: Category | null; siteKey: string };

export function Report({ id }: { id: ProviderId }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: Turnstile; id: string } | null>(null);
  const saving = useRef(false);
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    void requestJson<Session>(`/api/session/${id}`)
      .then(async (next) => {
        if (!active) return;
        setSession(next);
        if (!next.siteKey)
          throw new Error("Reporting is unavailable until verification is configured.");
        const api = await loadTurnstile();
        if (!active || !container.current) return;
        widget.current = {
          api,
          id: api.render(container.current, {
            sitekey: next.siteKey,
            action: "report",
            callback: setToken,
            "expired-callback": () => setToken(""),
            "error-callback": () => {
              setToken("");
              setError("Verification failed. Please retry verification.");
            },
          }),
        };
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Could not load your report.");
      });
    return () => {
      active = false;
      if (widget.current) widget.current.api.remove(widget.current.id);
      widget.current = null;
      setToken("");
    };
  }, [id, attempt]);

  async function report(category: Category) {
    if (!token || !session || saving.current) return;
    saving.current = true;
    const next = session.category === category ? null : category;
    setPending(true);
    setError("");
    setFeedback("");
    try {
      const result = await requestJson<{ category: Category | null }>(`/api/reports/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: next, token }),
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
        setError(
          "Your report was saved, but public counts could not refresh. Please refresh the page.",
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save your report. Please try again.",
      );
    } finally {
      setToken("");
      if (widget.current) widget.current.api.reset(widget.current.id);
      setPending(false);
      saving.current = false;
    }
  }

  return (
    <section className="report" aria-labelledby="feels">
      <h2 id="feels">My AI feels...</h2>
      <div
        className={`btns${session?.category ? " done" : ""}`}
        role="group"
        aria-label="Report an issue"
      >
        {categories.map((category) => {
          const Icon = icons[category];
          return (
            <Button
              key={category}
              className={`vibe-btn ${category}`}
              aria-pressed={session?.category === category}
              isDisabled={pending || !session || !token}
              onPress={() => {
                void report(category);
              }}
            >
              <Icon aria-hidden="true" />
              <span>{category}</span>
            </Button>
          );
        })}
      </div>
      <p className="hint" role="status">
        {pending
          ? "Saving your report..."
          : feedback ||
            (session?.category
              ? "Your report is selected. Tap again to undo."
              : "One report per AI per hour. Switch or undo anytime.")}
      </p>
      <div className="verification" ref={container} />
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <Button
            className="plain-button"
            isDisabled={pending}
            onPress={() => {
              setToken("");
              setAttempt((value) => value + 1);
            }}
          >
            Retry verification
          </Button>
        </div>
      )}
    </section>
  );
}
