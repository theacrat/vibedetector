import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { Button } from "react-aria-components";

import "@/styles.css";

const Route = createRootRoute({
  // The file route and component reference each other.
  // oxlint-disable-next-line eslint/no-use-before-define
  component: Root,
  errorComponent: ({ reset }) => (
    <main className="wrap prose">
      <h1>Couldn&apos;t load this page.</h1>
      <p role="alert">Please check your connection and try again.</p>
      <Button onPress={reset} className="plain-button">
        Try again
      </Button>
    </main>
  ),
  head: () => ({
    links: [
      { href: "https://fonts.googleapis.com", rel: "preconnect" },
      { crossOrigin: "anonymous", href: "https://fonts.gstatic.com", rel: "preconnect" },
      {
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=JetBrains+Mono:wght@500;700&display=swap",
        rel: "stylesheet",
      },
    ],
    meta: [
      { charSet: "utf8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "vibedetector - how's your AI feeling?" },
      {
        content:
          "Community reports of AI quality, latency and availability. Not official service status.",
        name: "description",
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="wrap prose">
      <h1>AI not found.</h1>
      <p>
        Choose a provider from the<Link to="/">homepage</Link>.
      </p>
    </main>
  ),
});

function Root() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="grain" aria-hidden="true" />
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="top">
          <Link className="logo" to="/" aria-label="vibedetector home">
            <svg className="logo-mark" viewBox="0 0 40 40" aria-hidden="true">
              <defs>
                <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ababab" />
                  <stop offset=".5" stopColor="#f0f0ed" />
                  <stop offset="1" stopColor="#ababab" />
                </linearGradient>
              </defs>
              <rect
                x="2"
                y="2"
                width="36"
                height="36"
                rx="11"
                fill="#202020"
                stroke="url(#logo-gradient)"
                strokeWidth="2.5"
              />
              <path
                d="M7 24 L13 24 L16 14 L20 30 L24 10 L27 24 L33 24"
                fill="none"
                stroke="url(#logo-gradient)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>
              vibe<b>detector</b>
            </span>
          </Link>
        </header>
        <Outlet />
        <footer className="foot">
          <p>Community reports, not official service status.</p>
          <nav aria-label="About vibedetector">
            <Link to="/privacy">Privacy</Link>
            <Link to="/methodology">Methodology</Link>
          </nav>
        </footer>
        <Scripts />
      </body>
    </html>
  );
}

export { Route };
