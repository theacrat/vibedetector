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

Reports contribute once per AI per fixed UTC hour. Category changes and undo apply to the active hour only. Earlier reports remain in historical charts until retention removes them.

Model reporting is optional. The database catalogue supplies available models; `seeds/models.ts` preserves the initial list only. A model is metadata on the existing provider-level report, not a separate vote. Graph filters do not alter provider verdicts or baselines. Apply all local migrations after updating; model migrations preserve existing reports and expand provider support to Z.AI and Kimi. Production migrations still require approval.

## Model administration

Open `/admin` to add, archive/reactivate or reorder models. Move up/down controls save one order per provider. Archived models are hidden from public choices and named graph filters; stored reports still contribute to provider-wide activity until normal retention expires them. Names cannot be renamed or deleted. Set `ADMIN_KEY` as a Worker secret with at least 32 randomly generated characters, not a memorable password. Never put it in Wrangler vars or commit it. The panel is disabled if the secret or admin rate limiter is missing.

Catalogues support up to 256 names per provider. New names append at the end; reorder controls persist immediately and affect both reporting and graph selectors.

For local development, use an ignored `.dev.vars` file containing a test-only `ADMIN_KEY`. Production uses Wrangler's protected secret input. Key entry exchanges the key for a one-hour HttpOnly session; the panel never stores it in localStorage or URL parameters. Rotate the key to revoke existing sessions. The initial migration uses INSERT OR IGNORE; deployments do not reset your catalogue edits.

## Gates

```sh
bunx playwright install chromium
bun run check
bun run deploy:check
```

These are the GitHub Actions gates and the local equivalent while Actions billing is unavailable. Enable pre-commit checks with `git config core.hooksPath .githooks`.

## Deployment checklist

Deployment requires explicit approval. No deployment runs automatically from CI.

1. Confirm the production D1 database `vibedetector-community-production` and its `database_id` in `wrangler.jsonc`. The older `vibedetector` database has an unrelated schema and must not be migrated by this service.
2. Create a managed Turnstile widget restricted to `vibedetector.net`. Set `TURNSTILE_SITE_KEY` in Wrangler vars and `TURNSTILE_SECRET_KEY` through Wrangler secrets. Never commit the secret.
3. Confirm the target Cloudflare account and ownership of the domain.
4. Apply production migrations with `bunx wrangler d1 migrations apply DB --remote` after approval.
5. Run all gates at the reviewed SHA, then `bun run deploy` after approval.
6. Verify the homepage, direct provider paths, a challenged report submission and scheduled retention on production.

The rate-limit binding is configured in Wrangler. Reporting fails closed when production bot protection is unconfigured. Keep separate databases and widgets for preview deployments.

Reporting protection is layered, not a guarantee of unique people. The edge limit is approximate and local to each Cloudflare location. Cookie clearing, multiple devices and distributed brigading remain possible. Enable Cloudflare managed WAF/bot rules appropriate to the account before launch, monitor rejected submissions and database usage, and adjust coarse limits if shared networks are affected.

Architecture and delivery decisions are in `docs/architecture.md`. Live rows expire after eight days. Cloudflare backups and security logs have separate retention policies. Community reports cannot prove service health or unique humans.
