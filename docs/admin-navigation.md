# Provider-first administration

Replace the crowded combined admin page with a concise provider list at `/admin`. Each row shows provider name, slug/state and an Edit link. Provider ordering remains on the list; creation opens a separate new-provider screen rather than an expanded form.

`/admin/providers/$provider` is a dedicated edit screen keyed by provider UUID. It contains provider details, save, archive/reactivate, and that provider's models with add, rename, archive/reactivate and ordering. No provider selector and no unrelated providers' model forms. Reload/deep links and back navigation work. Unknown UUIDs show an explicit not-found state, not a different provider. A new-provider screen creates a provider then opens its edit screen.

Keep key authentication, secure session, pending/error/focus handling and UUID ownership unchanged. Preserve every existing admin capability. Forms do not reset unsaved changes on unrelated model updates. Successful saved renames show current names; failed writes retain edits and display errors. Auth transitions focus the key field or screen heading.

The combined review also closes PR #7 findings: optional blank provider logos use the existing initial fallback; provider/model toggle controls retain keyboard focus; read-only model UUIDs are available; a provider archived during report verification returns 404 without a write. Catalogue reorder swap/focus behavior is shared rather than independently copied between providers and models.

The provider list is the sole authenticated dashboard content, not a second catalogue panel beneath every provider form. A provider editor includes exactly one provider and its model rows. Read-only UUID labels may be collapsed or small secondary text; primary labels and controls use human display names. Navigation and save feedback must remain readable at mobile widths.

Creation uses the authoritative mutation response to open the new UUID editor. A refresh failure after a committed save must be reported as refresh failure, not as a failed write or an invitation to duplicate the record. If the user leaves creation while a request is pending, a late completion cannot redirect the new screen.

Creation handoff state is one-use and never overrides a later authoritative provider read. Reload/back navigation must show persisted fields, while genuinely dirty inputs remain local until save. A committed create remains identifiable by UUID even if the following catalogue read returns 401; the UI may require sign-in again but must not offer a duplicate create.

Review both PR #7 (`06774c9...c6f4bed`) and this rework against standards and their own specs. Fix every finding and repeat independent reviews until clean before merging this rework. Run exact-head build/format/zero-warning lint/types/full tests/browser/packaging gates. User requested merge, not deployment of this rework.
