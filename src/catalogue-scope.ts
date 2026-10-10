const scopes: Record<string, string> = {
  "10000000-0000-4000-8000-000000000008":
    "Cloud Agent models. Not the complete Cursor IDE catalogue.",
  "10000000-0000-4000-8000-000000000009":
    "Provider reporting only. No supported model listing API.",
};

function catalogueScope(provider: string): string {
  return (
    scopes[provider] ??
    "Official API-discovered models available to the configured account. Not an exhaustive consumer catalogue."
  );
}

export { catalogueScope };
