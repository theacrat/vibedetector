# vibedetector

Community reports for AI services, built for vibedetector.net. The supplied prototype defines the visual layout. Reports are not official status or evidence of a model change.

## Local development

Install Bun 1.4.2 and Node 24. Wrangler and Vite run with Node because Wrangler does not support Bun's runtime.

```sh
bun install --frozen-lockfile
bun run typegen
bunx wrangler d1 migrations apply DB --local
bun run dev
```

Open http://127.0.0.1:41873. Localhost uses Cloudflare's Turnstile test keys. These keys are never accepted on the production hostname. Local data stays in `.wrangler/`.

## Gates

```sh
bunx playwright install chromium
bun run check
bun run deploy:check
```

These are the GitHub Actions gates and the local equivalent while Actions billing is unavailable. Enable pre-commit checks with `git config core.hooksPath .githooks`.

## Deployment checklist

Deployment requires explicit approval. No deployment runs automatically from CI.

1. Create a production D1 database named `vibedetector`. Set its `database_id` in `wrangler.jsonc`.
2. Create a managed Turnstile widget restricted to `vibedetector.net`. Set `TURNSTILE_SITE_KEY` in Wrangler vars and `TURNSTILE_SECRET_KEY` through Wrangler secrets. Never commit the secret.
3. Confirm the target Cloudflare account and ownership of the domain.
4. Apply production migrations with `bunx wrangler d1 migrations apply DB --remote` after approval.
5. Run all gates at the reviewed SHA, then `bun run deploy` after approval.
6. Verify the homepage, direct provider paths, a challenged report submission and scheduled retention on production.

The rate-limit binding is configured in Wrangler. Reporting fails closed when production bot protection is unconfigured. Keep separate databases and widgets for preview deployments.

Architecture and delivery decisions are in `docs/architecture.md`. Live rows expire after eight days. Cloudflare backups and security logs have separate retention policies. Community reports cannot prove service health or unique humans.
