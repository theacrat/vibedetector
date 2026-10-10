# API-managed model catalogue

## Scope and evidence

Provider membership comes from supported server adapters, not administrator input. Each adapter uses its service's official model discovery API. Provider metadata remains code-owned because these APIs list models, not competing services.

Sources checked on 10 October 2026:

- [OpenAI](https://developers.openai.com/api/reference/resources/models/methods/list) lists `data[].id` at `https://api.openai.com/v1/models`. No pagination is documented.
- [Anthropic](https://platform.claude.com/docs/en/api/models/list) lists `data[].id` and `display_name` at `https://api.anthropic.com/v1/models`. Follow `has_more` and `last_id` using `after_id`.
- [Google](https://ai.google.dev/api/models) lists `models[].name` at `https://generativelanguage.googleapis.com/v1beta/models`. Follow `nextPageToken` using `pageToken`. Include models supporting `generateContent`.
- [xAI](https://docs.x.ai/developers/rest-api-reference/inference/models) lists `data[].id` at `https://api.x.ai/v1/models`. No pagination is documented.
- [Mistral](https://docs.mistral.ai/api/endpoint/models) lists `data[].id` at `https://api.mistral.ai/v1/models`. No pagination is documented.
- [DeepSeek](https://api-docs.deepseek.com/api/list-models) lists `data[].id` at `https://api.deepseek.com/models`. No pagination is documented.
- [Kimi](https://platform.kimi.ai/docs/api/list-models.md) lists `data[].id` at `https://api.moonshot.ai/v1/models`. No pagination is documented. API Platform credentials are distinct from Kimi Code and consumer credentials.
- [Cursor](https://cursor.com/docs/cloud-agent/api/endpoints) lists `items[].id` and `displayName` at `https://api.cursor.com/v1/models`. These are recommended Cloud Agent models, not the complete IDE catalogue. The endpoint has no documented pagination.
- [Z.AI's official OpenAPI](https://docs.z.ai/openapi.json) and [documentation index](https://docs.z.ai/llms.txt) contain no model listing endpoint. OpenAI compatibility does not prove that `/models` exists.

The user chose to keep Cursor with an explicit Cloud Agent catalogue label and keep Z.AI for provider-level reporting without model choices. Archive their old manual choices at migration. Retire Copilot's provider and models without deleting rows or reports.

## Data and ownership

`ProviderAdapter` owns provider metadata, secret binding, endpoint, response format, and pagination protocol. `ExternalModel` contains the exact service ID and a catalogue name. Existing report references remain D1 UUIDs. Add nullable `external_id` and a unique `(provider, external_id)` index to `models`. Null identifies a legacy manual row, never a guessed API identity.

Use exact API IDs as catalogue names. Cursor additionally includes the official display name and ID. An exact catalogue-name collision may adopt an existing UUID; never fuzzy-match consumer labels. API-backed UUIDs survive renames, disappearance, and reappearance. Missing and legacy models are archived only when a complete valid nonempty result replaces a provider's catalogue. Historical rows remain available to saved-report metadata.

`catalogue_sync` stores provider UUID, last attempt, last success, result count, sanitised status, lease token, and expiry. The administrator sees status and can refresh one provider or all supported providers. Provider creation, editing, ordering, state changes, and model editing disappear from both HTTP mutations and UI.

## Safe synchronisation

Acquire a per-provider D1 lease with an atomic conditional update. Fetch every page before writing models. Bound requests by timeout, total duration, page count, model count, and response size. Reject malformed IDs, duplicates, empty final catalogues, invalid pagination, repeated tokens, HTTP errors, and undocumented continuation fields. Do not log raw upstream responses or secrets.

Commit upserts, missing-model archival, and success status in one D1 batch. Every write is fenced by the lease token and unexpired lease. Use a SQL constraint guard in the batch so a stale owner rolls back rather than silently claiming success. Release and failure status are also token-fenced. An expired worker cannot overwrite its successor's catalogue or status.

Per-provider failures preserve the previous catalogue and last success. Missing secrets are visible as unconfigured, not success. Other providers continue. The hourly retention job remains unchanged; a separate daily cron runs model sync. Authenticated refresh shares the lease and cooldown to prevent request storms. Secrets exist only in Worker bindings and local server configuration.

## Alternatives and delivery

A Durable Object per provider provides serialisation but adds a deployment binding and resource for a daily bounded operation. D1 leases keep state beside the catalogue and avoid a new dependency. A single global lease would let one provider failure block unrelated providers.

Throughput checkpoint: first commit this design, then implement adapters and atomic storage, then replace admin controls and document operation. Test API boundaries, pagination, UUID stability, rollback, fencing, independent failures, retired services, and the running admin UI. Run the full repository gates and dry-run deployment at reviewed HEAD, then obtain independent review before opening and merging the PR. No deployment or production migration occurs in this task.
