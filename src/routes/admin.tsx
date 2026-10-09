import { createFileRoute } from "@tanstack/react-router";

import { ModelAdmin } from "@/ui/admin";

const Route = createFileRoute("/admin")({
  component: ModelAdmin,
  head: () => ({ meta: [{ title: "Model administration - vibedetector" }] }),
});

export { Route };
