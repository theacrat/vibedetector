# Provider-first administration

Replace the crowded combined admin page with a concise provider list at `/admin`. Each row shows provider name, slug/state and an Edit link. Provider ordering remains on the list; creation opens a separate new-provider screen rather than an expanded form.

`/admin/providers/$provider` is a dedicated edit screen keyed by provider UUID. It contains provider details, save, archive/reactivate, and that provider's models with add, rename, archive/reactivate and ordering. No provider selector and no unrelated providers' model forms. Reload/deep links and back navigation work. Unknown UUIDs show an explicit not-found state, not a different provider. A new-provider screen creates a provider then opens its edit screen.

Keep key authentication, secure session, pending/error/focus handling and UUID ownership unchanged. Preserve every existing admin capability. Forms do not reset unsaved changes on unrelated model updates. Successful saved renames show current names; failed writes retain edits and display errors. Auth transitions focus the key field or screen heading.

Review both PR #7 (`06774c9...c6f4bed`) and this rework against standards and their own specs. Fix every finding and repeat independent reviews until clean before merging this rework. Run exact-head build/format/zero-warning lint/types/full tests/browser/packaging gates. User requested merge, not deployment of this rework.
