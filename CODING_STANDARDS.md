# Coding standards

Use strict TypeScript without `any`. Keep external validation at HTTP and storage boundaries. Represent providers, categories and ranges through the shared domain registry. Parameterise SQL. Never log identity cookies, IP addresses, secrets or challenge tokens.

Keep UI faithful to the prototype. Counts must come from persisted reports. Missing data or errors must not appear as health. Interactive controls need keyboard access, visible focus and pending/error feedback.

Keep tests in `tests/` and generated files in `src/generated/`. Run `bun run check` and `bun run deploy:check` at the exact reviewed HEAD before merge. GitHub Actions runs the same commands. Local equivalent gates are accepted while GitHub Actions billing is unavailable.

Production reporting must fail closed if Turnstile verification or rate limiting is unavailable. Development bypasses are forbidden outside localhost. Deployments require approval.
