import { createFileRoute } from "@tanstack/react-router";

import { ModelAdmin } from "@/ui/admin";

const screen = { kind: "new" as const };
function NewProvider() {
  return <ModelAdmin screen={screen} />;
}

const Route = createFileRoute("/admin_/providers/new")({
  component: NewProvider,
  head: () => ({
    meta: [
      { title: "Add provider - vibedetector" },
      { content: "noindex, nofollow", name: "robots" },
    ],
  }),
});

export { Route };
