# Vibedetector architecture

## Product

Community reports of AI quality, latency and availability, not official outage declarations. Follow the supplied prototype's charcoal palette, typefaces, raised purple/amber/red buttons and chart layout. `/` lists eight providers with separate `/claude`, `/chatgpt`, `/gemini`, `/copilot`, `/grok`, `/mistral`, `/deepseek` and `/cursor` pages. Never fabricate activity.

## Domain

`Provider` is a registry entry with slug, name, maker and official status URL. `Category` is `nerfed | slow | broken`. Reports have a provider, category, timestamp and anonymous browser identity. An opaque random HttpOnly cookie identifies a browser. One report per provider per browser per fixed hour. Retrying is idempotent, switching updates and undo removes. IP addresses are not stored in reports.

`Dashboard` contains UTC-aligned buckets, hourly count, baseline and verdict. Ranges are 6h (15-minute buckets), 24h (30-minute buckets) and 7d (3-hour buckets). Insufficient history or volume means insufficient data, never good vibes.

Include the partial boundary buckets needed to cover the full selected duration. Label the newest count as `since <device-local time>`, not a rolling count. Chart labels use the device timezone after hydration, while storage and aggregation remain UTC. The hero separately counts the actual trailing hour. Session responses identify their fixed reporting window; mutations reject stale windows so an hour rollover cannot falsely undo an earlier contribution.

The wire field `window` is an integer UTC hour index, not a timestamp. Its next boundary in milliseconds is `(window + 1) * 3_600_000`. A report from an earlier window remains historical data; undo applies only to the active window.

## Architecture

TanStack Start and React on Cloudflare Workers with the Cloudflare Vite plugin. D1 owns reports, atomic deduplication constraints and historical queries. Parameterised SQL only. Shared typed registry and pure aggregation functions. One server module owns storage; same-origin JSON APIs validate input at boundaries. Bounded bodies, matching Origin and HttpOnly cookies protect writes.

Alternative per-provider Durable Objects serialise counters but require custom historical query machinery. Select D1 for a small reporting workload. Add aggregation tables only if measured load warrants them.

## Anti-bot measures

Require server-verified Turnstile on every report mutation. Check Siteverify success, expected hostname and action. Test keys work only on localhost. Fail closed on missing production configuration or verification errors. Cloudflare rate-limit binding throttles writes by IP before verification. D1 uniqueness prevents concurrent duplicate reports. No client-only security checks. No production bypass. Rate limiting and Turnstile mitigate abuse but cannot guarantee unique humans.

The IP limit is a coarse defence and may affect shared networks. Cloudflare rate-limit counters are approximate and local to each edge location, not a global quota. D1's constraint, not the edge counter, owns report deduplication. Keep the rate-limit namespace unique within the account.

Source contracts were checked against Cloudflare's [Siteverify documentation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) and [rate-limit binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Privacy and operations

The session date is 9 October, but the local system and Miniflare run on 8 October UTC. Pin compatibility to 2026-10-08 so local and deployed runtime gates use the same supported date.

Delete reports after eight days via an hourly scheduled handler. Do not log cookies, tokens or IP addresses. Publish privacy and methodology pages. Enable Worker logs and traces. Wrangler targets vibedetector.net. D1 provisioning, Turnstile setup, secrets and migrations precede deployment. Deployment remains a separate approval boundary.

## Delivery checkpoint

1. Commit design and baseline.
2. Scaffold framework and shared contracts.
3. Build UI and reporting backend in isolated worktrees.
4. Verify SSR paths, persistence, failures and mobile UI in a running local Worker.
5. Run formatter, lint, types, tests, browser checks, build and deploy dry run locally with the same gates as GitHub Actions.
6. Open and link PR. Run independent standards/spec review, fix findings and repeat gates before merge.
