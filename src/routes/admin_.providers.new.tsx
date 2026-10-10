import { createFileRoute, redirect } from "@tanstack/react-router";

const Route = createFileRoute("/admin_/providers/new")({
  beforeLoad: () => {
    // TanStack uses a thrown redirect response to stop loading the retired creation route.
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ to: "/admin" });
  },
});

export { Route };
