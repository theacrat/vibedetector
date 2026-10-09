import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { ModelAdmin } from "@/ui/admin";

const Route = createFileRoute("/admin_/providers/$provider")({
  // Route parameters are accessed through the route declared here.
  // oxlint-disable-next-line eslint/no-use-before-define
  component: ProviderEdit,
  head: () => ({
    meta: [
      { title: "Edit provider - vibedetector" },
      { content: "noindex, nofollow", name: "robots" },
    ],
  }),
});
function ProviderEdit() {
  const { provider } = Route.useParams();
  const screen = useMemo(() => ({ kind: "edit" as const, providerId: provider }), [provider]);
  return <ModelAdmin key={provider} screen={screen} />;
}
export { Route };
