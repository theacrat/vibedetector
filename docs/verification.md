# Verification contract

Run the release gates at a committed HEAD without editing during the run. Record `git rev-parse HEAD` with results in the PR, not a claim based on an earlier build.

## Local equivalent of CI

```sh
bun install --frozen-lockfile
bun run typegen
bunx playwright install chromium
bunx wrangler d1 migrations apply DB --local
bun run check
bun run deploy:check
```

`check` covers formatting, type-aware lint, TypeScript, domain/chart/storage/security tests, production build and browser tests. Browser tests exercise actual local Worker bindings, not a mocked report API. Cloudflare test challenges are used only on loopback hosts. These tests do not prove a production widget or deployed resource works.

## Review

Review `git diff main...HEAD` against `CODING_STANDARDS.md` and `docs/architecture.md` using separate standards and specification reviewers. The first review identified missing chart tests in the gate, duplicated read orchestration, unvalidated storage rows, stale reporting-window behaviour, partial-bucket labelling and retention throughput. All findings require fixes and a clean follow-up review before merge.

## Runtime observations

The running app showed all eight provider links and direct paths with SSR content. Desktop and mobile browser checks confirmed reloads and no horizontal overflow. A live localhost submission revealed that Cloudflare's test Siteverify result has hostname `example.com`, testing-key metadata and no action. The local test branch must validate that documented test response shape; production must continue to enforce the configured hostname and `report` action.

Follow-up reviewers independently found an hour-index versus millisecond mismatch in the UI rollover timer. Test the next-boundary conversion explicitly and assert that idle controls do not issue repeated session requests. Route generation must run before type-aware lint on a fresh checkout, not depend on leftovers from local development.

## Production boundary

Dry-run packaging cannot verify a remote D1 database, Turnstile widget, DNS, or cron execution. The deployment checklist in `README.md` owns these checks after explicit approval. Never describe local gates as production verification.
