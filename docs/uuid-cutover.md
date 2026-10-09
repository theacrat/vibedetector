# UUID catalogue cutover

Approved scope is Worker `vibedetector` in account `85cd914334836de8bb8e1f0874e11da8` and its dedicated D1 database `vibedetector-community-production` (`a73bac50-12b3-4bb3-a427-c8207e35dad7`). The older database named `vibedetector` is unrelated and excluded.

1. Complete local schema/UI migration and independent review before remote writes.
2. Capture a fresh read-only export of the dedicated production database immediately before cutover. Treat exports as protected temporary data, not PR attachments. Preserve admin key and Turnstile secrets without reading them into chat.
3. Create a new UUID-catalogue database and import the legacy snapshot. Reconcile source provider model counts/order/active state, then apply the new UUID migration. Existing report identity hashes and UTC windows remain unchanged.
4. Compare every mapped report/category/timestamp and all provider/model records between source and replacement. Fail on unknown names or slugs rather than dropping rows. Keep the old database unchanged as rollback.
5. Bind the Worker to the replacement database, run exact-head build/types/tests/packaging, and deploy the approved reviewed revision. No need to take the existing site down before the replacement is ready.
6. Verify live admin provider/model create/rename/archive/order, existing route slugs, UUID filter/report identity, login/logout, public archive visibility and bot protection. Avoid synthetic public report pollution; use an isolated local Worker for report mutation tests.
7. Remove local export/key staging files. Leave the original dedicated database available for rollback unless cleanup is separately requested after successful verification.

If reports or catalogue edits occur after the export, repeat the snapshot before cutover. This deployment is small and the user is currently the only visitor, but data reconciliation is still a gate. Changing a display name does not change a URL; changing a slug explicitly invalidates the old slug.
