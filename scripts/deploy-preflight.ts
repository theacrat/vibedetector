async function preflight() {
  const config: unknown = Bun.JSONC.parse(await Bun.file("wrangler.jsonc").text());

  if (
    typeof config !== "object" ||
    config === null ||
    !("vars" in config) ||
    !("d1_databases" in config)
  ) {
    throw new Error("Wrangler configuration is incomplete.");
  }
  const variables = config.vars;
  const databases = config.d1_databases;
  if (
    typeof variables !== "object" ||
    variables === null ||
    !("TURNSTILE_SITE_KEY" in variables) ||
    typeof variables.TURNSTILE_SITE_KEY !== "string" ||
    !variables.TURNSTILE_SITE_KEY ||
    variables.TURNSTILE_SITE_KEY.startsWith("1x") ||
    variables.TURNSTILE_SITE_KEY.startsWith("2x") ||
    !Array.isArray(databases) ||
    !databases.some(
      (database: unknown) =>
        typeof database === "object" &&
        database !== null &&
        "binding" in database &&
        database.binding === "DB" &&
        "database_id" in database &&
        typeof database.database_id === "string" &&
        database.database_id.length > 0,
    )
  ) {
    throw new Error(
      "Set a production Turnstile site key and D1 database_id before deploying. Deployment still requires approval.",
    );
  }
  console.log(
    "Production resource configuration is present. Confirm the Turnstile secret and deployment approval separately.",
  );
}
await preflight();
