# Optional model reporting

Reports remain provider-level contributions. Add nullable model metadata from a hardcoded provider-specific list. Default `AI` means no model specified, not a guessed model. Heading becomes `My [AI/model selector] feels...`. Selecting a model changes the next report intent; it does not write until a category is submitted. Preserve model metadata across reloads and category changes; undo clears a report's active contribution. One contribution per browser/provider/hour still applies, regardless of model.

Tapping the saved category with a different selected model updates metadata, not undo. Only the same category and same saved model toggles retraction. Cancelled verification must leave the persisted report untouched; the selected draft may remain for a subsequent attempt.

Reload restores the persisted active report model, not an unsaved draft. Reporting selection is scoped to the provider. Hardcoded labels used in persisted metadata are append-only: do not rename or remove labels until a migration/alias policy preserves historical rows and shared URLs. Empty string and `unspecified` are reserved graph-filter values.

Add `/zai` (Z.AI) and `/kimi` (Kimi) to the shared provider registry, homepage, other-provider links, sitemap and logos. Existing providers and URLs stay stable. Hardcoded model lists are UI labels, not an assertion of live availability.

Initial model labels are curated from the models.dev catalogue checked during implementation. Kimi links to Moonshot's official `status.moonshot.cn`. No verified Z.AI status page was found, so link its website as a website, not an official status claim.

Add an additive nullable `model` column via migration; old reports remain unspecified. HTTP and storage boundaries validate model names against the provider list. Omitted model means unspecified for compatibility with existing clients. Session/mutation responses return saved model. Report deduplication and timestamps do not change.

The original SQL schema restricts provider IDs through a CHECK constraint. The migration must preserve rows while expanding that constraint for Z.AI and Kimi, then preserve both timestamp indexes. Test the migration against populated v1 data before any production execution.

Graph filter is independent of the reporting selection and stored in `?model=` alongside range. `All models` includes unspecified reports; `Unspecified` selects null metadata. Filter only displayed buckets and graph category/peak statistics. Provider hourly totals, sufficient-data gating, baseline and verdict always use all provider reports. Hide provider baseline/ratio on filtered graphs rather than implying a model-level algorithm. Empty filtered results must not change the provider verdict.

Invalid or cross-provider filters are rejected at the API/server boundary and normalised to all models in browser URL parsing. Model changes preserve the selected range; range changes preserve the selected model. Provider navigation starts with all models so a label from one provider never leaks into another.

Remove the chart's entire `x reports since time` line. Keep range controls and add an accessible model filter. Retain local-time axes/tooltips and challenge UX.

Verify migration preserves old rows, model validation, persistence/change/undo, provider-only verdict invariance for every filter, shareable model/range URLs, new provider paths, anti-bot gates and mobile selectors. Run local gates and independent standards/spec reviews before merge. Do not deploy or migrate production without release approval.

Backend verification uses actual Miniflare D1. Tests assert literal identical totals, baselines and each verdict severity for all/unspecified/named filters, and confirm existing dedup keys and indexes survive the migration. No new probe, confidence metric or model-level verdict is introduced.
