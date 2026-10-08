# Friendlier reporting

Keep the approved prototype layout. Display chart axes, tooltip times and interval descriptions in the device timezone after hydration; use a stable UTC SSR fallback without hydration mismatch. Aggregation stays UTC internally.

Remove hourly-limit instructional prose from the report panel, not server deduplication. Replace technical current-bucket copy with `since <local time>` so partial counts remain honest. Add models.dev provider logos to hero tiles and cards with explicit mapped identifiers, local copies and source attribution.

Reporting buttons should work without waiting for a visible challenge. Fetch session identity on mount, but start verification after a category click. Use managed Turnstile's interaction-only appearance in an accessible dialog. It may solve without user interaction; otherwise the dialog provides the real challenge, retry and cancel. Never hide an interactive challenge or bypass Siteverify. Preserve selected category intent, prevent duplicate writes, obtain a fresh token for each mutation and safely cancel stale callbacks.

Publish the existing sufficient-data rule clearly in methodology and link it from insufficient-data copy. Do not change thresholds in this UI change. Current rule requires an older report spanning at least 48 hours and 100 non-retracted reports in the prior 48 complete hourly intervals. Baseline is total/48; 10 reports plus 2x baseline is elevated, 20 plus 5x is severe. This is not a statistical confidence guarantee or confirmed health.

Verify device timezone including day boundaries and DST, silent and interactive challenge flows, cancel/retry, change/undo, and existing security/SSR/browser gates. Independent standards/spec PR reviews must be clean before merge. Deployment requires renewed approval for this release.
