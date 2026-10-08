interface Turnstile {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      appearance: "interaction-only";
      execution: "execute";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  execute: (id: string) => void;
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
          script.remove();
          turnstileScript = undefined;
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

interface Widget {
  api: Turnstile;
  id: string;
}

function mountWidget(
  api: Turnstile,
  container: HTMLDivElement,
  siteKey: string,
  onToken: (token: string) => void,
  onError: (message: string) => void,
) {
  const widget: Widget = {
    api,
    id: api.render(container, {
      action: "report",
      appearance: "interaction-only",
      callback: onToken,
      "error-callback": () => {
        onError("Verification failed. Please retry verification.");
      },
      execution: "execute",
      "expired-callback": () => {
        onError("Verification expired. Please retry verification.");
      },
      sitekey: siteKey,
    }),
  };
  api.execute(widget.id);
  return widget;
}

export { loadTurnstile, mountWidget };
export type { Turnstile };
