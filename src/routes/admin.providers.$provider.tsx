import { createFileRoute } from "@tanstack/react-router";

import { ModelAdmin } from "@/ui/admin";

const Route = createFileRoute("/admin/providers/$provider")({
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
  return <ModelAdmin providerId={provider} />;
}
export { Route };
