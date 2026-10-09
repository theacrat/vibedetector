import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { ModelAdmin } from "@/ui/admin";

const Route = createFileRoute("/admin_/providers/$provider")({
  // Route hooks need the hoisted component to close over this route instance.
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
