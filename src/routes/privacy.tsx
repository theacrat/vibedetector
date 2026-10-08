import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy - vibedetector" }] }),
  component: () => (
    <main className="wrap prose" id="main">
      <p className="maker">About vibedetector</p>
      <h1>Privacy</h1>
      <h2>Anonymous browser identity</h2>
      <p>
        We use an opaque, randomly generated HttpOnly cookie to remember your reports and enforce
        one report per provider per hour. It is not an account or a name.
      </p>
      <h2>What we store</h2>
      <p>
        A report contains the provider, category, timestamp and anonymous browser identity. Reports
        are deleted after eight days. Public charts show aggregate counts, not individual
        identities.
      </p>
      <h2>Abuse prevention</h2>
      <p>
        Cloudflare Turnstile verifies every report change, including undo. IP addresses may be
        processed for rate limiting, but are not stored in reports. We do not log cookies,
        verification tokens or IP addresses.
      </p>
      <h2>Your control</h2>
      <p>
        Tap your selected category again to remove your current report. Clearing your browser
        cookies removes the browser's ability to identify and undo earlier reports. Google Fonts
        supplies the typefaces used on this site and receives requests from your browser.
      </p>
    </main>
  ),
});
