# Admin simplification

The admin's main job is maintaining each provider's model list. Keep the existing
colours, typography and routing; reduce the amount of editing UI shown at once.

- Show providers alphabetically as compact name, status and edit rows. No manual
  provider reordering controls.
- Open a provider to its model list, with provider settings below the models.
- Each model is a single line: its name and Lucide edit, up, down and archive icons.
  Edit replaces the name with an input and the edit icon with a save icon. Failed
  saves retain the draft. Archived names are struck through and can be restored.
- Do not show IDs or summary/disclosure blocks. Keep the add-model form visible.
- Newly created models go first; existing model ordering is preserved.
- Keep unsaved fields through other operations. Preserve
  authoritative server updates, UUID identity and keyboard focus after writes.
- Use the existing palette and type scale, a narrower single column and quiet
  dividers. No new dashboard, decorative cards or dependencies.

Check navigation, successful and failed writes, ordering, keyboard focus and mobile
overflow with the existing browser tests, updated for inline editing.
