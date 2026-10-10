# Model catalogue eligibility and order

## Contract

Both selectors receive one backend order. A sync uses only the configured account's validated API catalogue. Unknown capabilities remain visible. Explicit non-chat capabilities, retired or deprecated lifecycle, fine-tuning, third-party publishing, and documented alias relationships can exclude a model. Exact callable OpenAI snapshots remain separate identities.

The normalised shape is `ExternalModel { id, name, metadata? }`. Metadata records eligibility reasons, explicit aliases, reliable release time and its source, capability evidence, and bounded provider variant metadata. Missing metadata does not imply unsupported capability. Malformed supplied metadata fails the sync before catalogue replacement.

## Existing flow and chosen ownership

`model-api.ts` validates authenticated HTTP pages, enforces bounds, and normalises provider evidence. `catalogue-sync.ts` acquires a lease, refreshes OpenAI's existing documentation cache, combines evidence, and replaces catalogue membership in one fenced D1 batch. `catalogue.ts` returns persisted positions. `ModelSelect` already preserves that order for report and chart selectors.

Keep this flow. An alternative is separate per-provider synchronisers with their own persistence and filtering. That repeats lease and replacement logic and risks inconsistent historical identity. A pure metadata policy module gives the smaller boundary without changing transport ownership.

## Evidence rules

- OpenAI uses cached official endpoint and output modality tables. Text output plus Chat Completions or Responses is eligible. Unknown documents fail open. API `created` provides a date. Documented exact snapshots are not alias-deduplicated.
- Anthropic uses lifecycle and `created_at` from the Models API.
- Gemini keeps the existing `generateContent` requirement. Exact documented specialised model records fill gaps in its sparse API. No ID-pattern exclusion. Official model documentation supplies output capabilities and lifecycle where available.
- Grok uses `/v1/language-models`, its `models` collection, output modalities, aliases, and release timestamps.
- Mistral uses `completion_chat`, deprecation, and model type. `owned_by` identifies the API operator, not the original publisher. Exact official publisher evidence excludes routed GLM. Explicit `name` and `aliases` relationships choose the canonical listed model. Request-time `created` is not a release date.
- DeepSeek uses output modalities. Kimi accepts reasoning or explicitly supported text chat. Kimi's unstable `created` is not a release date.
- Cursor retains returned Cloud Agent choices including Auto and variant metadata. Z.AI keeps unknown capabilities and uses its model release timestamps.

## Persistence and replacement

Migration 0007 adds catalogue metadata and first-seen timestamps without modifying UUIDs or reports. First-seen values never change on repeat sync or reappearance. Excluded entries retain existing UUIDs as archived. New eligible models get new UUIDs. Archive reasons and evidence remain available in storage without crowding the public UI.

Order is newest first by reliable provider release time, otherwise persistent first-seen time, then exact external ID. Missing release dates are not guessed from display names. Repeated syncs cannot move models by assigning a new first-seen time. Existing catalogue entries receive a common migration baseline.

An upstream empty catalogue remains a sync failure and preserves the previous catalogue. A non-empty, fully validated response with every model explicitly excluded is a valid zero-active catalogue and archives existing choices atomically. Invalid metadata, pagination, limits, and expired leases preserve catalogue membership.

## Verification workflow

1. Ground the provider fields and commit this design.
2. Add boundary and policy tests before catalogue integration.
3. Add D1 tests for order, arrivals, stable UUIDs, exclusion, reappearance, alias archives, valid all-filtered responses, failures, and saved report ownership.
4. Run full checks and deployment dry-run at the exact committed SHA.
5. Inspect both selectors in a running local app backed by real D1 on desktop and mobile.
6. Open a PR and request the parent's independent review before merge. Nested delegation is unavailable, so the parent owns the independent review layer.

The critical path is provider evidence, normalisation, D1 integration, then live verification. Keep transport and persistence changes serial in the owned worktree. No production migration or deployment is part of this change. Account inventories remain local and are neither committed nor uploaded.

## Evidence checked on 11 October 2026

[Google's model catalogue](https://ai.google.dev/gemini-api/docs/models) and [release notes](https://ai.google.dev/gemini-api/docs/changelog) identify exact specialised endpoints, lifecycle, and release dates. [Gemini 2.5 Flash Image](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image) explicitly supports text and image output, so image generation does not by itself make a model image-only. The implementation keeps multimodal text-output models.

[Mistral's catalogue](https://docs.mistral.ai/models) and [GLM 5.3 record](https://docs.mistral.ai/models/zai-glm-5-3) identify third-party publishing. [Mistral Large 4](https://docs.mistral.ai/models/mistral-large-4-0) supplies its release date. The API inventory confirms that `owned_by` is `mistralai` for both native and routed models, so it cannot discriminate publisher ownership.

[xAI's model reference](https://docs.x.ai/developers/rest-api-reference/inference/models) documents the authenticated language catalogue, creation dates, output modalities, and aliases. Exact documented records are a maintained supplement to sparse API responses, not a catalogue of assumed unsupported ID patterns. Future unknown IDs stay visible.
