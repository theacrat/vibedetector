# Admin simplification

The admin's main job is maintaining each provider's model list. Keep the existing
colours, typography and routing; reduce the amount of editing UI shown at once.

- Show providers alphabetically as compact name, status and edit rows. No manual
  provider reordering controls.
- Open a provider to its model list, not a six-field settings form.
- Show each model's name and status. Reveal rename, archive and ordering controls
  through an explicit edit disclosure. Keep IDs behind their existing disclosure.
- Reveal the add-model form on request and provider settings below the models.
- Keep disclosures mounted so unsaved fields survive other operations. Preserve
  authoritative server updates, UUID identity and keyboard focus after writes.
- Use the existing palette and type scale, a narrower single column and quiet
  dividers. No new dashboard, decorative cards or dependencies.

Check navigation, successful and failed writes, ordering, keyboard focus and mobile
overflow with the existing browser tests, updated for the deliberate disclosures.
