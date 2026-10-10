# OpenAI model enrichment

The model catalogue remains the source of truth for account-visible model IDs. OpenAI model enrichment adds documented capabilities without changing catalogue activity when documentation is unavailable.

## Source

OpenAI serves documentation Markdown when the request includes `Accept: text/markdown`. The source is `https://developers.openai.com/api/docs/models/{document}.md`. The models index is also available as Markdown at `/api/docs/models.md`.

The enrichment stores the source URL and the fetched document fields as JSON. The data is labelled as official OpenAI documentation, not as an OpenAI API response. The OpenAI `GET /models/{id}` response was checked and did not provide these fields.

## Resolution

The index provides explicit model-page links. A model ID is accepted only when its page states `Model ID` with the exact ID or lists the exact ID in its `Snapshots` section. The resolver never strips a date suffix or infers a family from a prefix.

An ID that has no exact documented match remains in the catalogue with `status = 'unknown'`. A failed fetch leaves the previous JSON and successful timestamp intact.

The metadata table is independent of models and reports. Its key is `(provider, external_id)`. The page cache stores positive and negative results independently so unsupported models do not cause daily per-model requests. An incomplete page-cache bootstrap leaves unmatched IDs eligible for resolution on the next sync. Each ID has a persisted discovery timestamp. A new ID refreshes the official index and bounded pages older than its discovery, including negative pages. Snapshot resolution still requires explicit membership, not a parent-name guess. Only complete, successfully fetched evidence can start a seven-day negative window.

Model status describes resolution, either `ok` or `unknown`. Fetch failures belong to the page cache's checked and successful timestamps, not a third model status that would discard a previous successful resolution.

## Bulk-source investigation

The official models index Markdown contains descriptions and links, not per-model capabilities. Its HTML contains no JSON capability payload. Its JavaScript imports a minified bundle containing model and snapshot data, but the format is executable code, not a documented JSON contract. Parsing or executing the bundle would couple production code to compiler output.

The official `/llms-full.txt` and `/api/docs/llms-full.txt` exports omit model detail pages. The official compare-page Markdown has context windows, maximum output tokens, and supported endpoints, but accepts at most five models per response. It omits modalities and snapshot membership.

These sources were fetched on 11 October 2026. No safe one-request bulk metadata source was found. The implementation therefore retains the weekly policy for per-page documentation fetches. No third-party catalogue is used.

## Schedule and safety

Catalogue listing keeps its existing daily behaviour. Enrichment runs for new or missing IDs and for metadata older than seven days. A cached index supplies explicit page links, and a cached page supplies exact snapshot membership. An index refresh and at most 20 model-page requests run per catalogue sync, with a maximum of four page requests in flight. Each request has a 15 second deadline, follows no redirects, and streams at most 512 KiB. The whole enrichment pass has a 35 second deadline. The worst-case bootstrap uses 21 extra HTTP requests, not one.

The 20-page limit spreads an initial catalogue across several daily syncs. Exact ID pages take priority. Snapshot-only IDs resolve when their documented parent page enters the cache. Successful and failed page checks are cached for seven days. A new model forces bounded discovery against the official index and pages older than its detection, even when weekly caches have not expired.

Enrichment uses the catalogue sync lease as its fence. A stale worker cannot write metadata after the lease expires or changes. Enrichment failure never archives models and never replaces the successful catalogue sync.

## Throughput checkpoint

- Blocking first steps. Fetch the official formats and reject undocumented bulk parsing before implementation.
- Independent workstreams. Not applicable. One owner implements the source, persistence, and sync boundary without nested delegates.
- Shared mutable state. The worktree starts at `212195c` and does not contain the root GLM changes. Cache and metadata writes are conditional on the current catalogue lease.
- Smallest safe decomposition. The documentation resolver owns the source contract and refresh policy. Catalogue sync invokes it before releasing its lease. Independent review belongs to the parent session.
