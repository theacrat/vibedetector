import type { Provider } from "@/domain";

const provider: Provider = {
  active: true,
  id: "10000000-0000-4000-8000-000000000001",
  logo: "/logos/claude.svg",
  maker: "Anthropic",
  name: "Claude",
  slug: "claude",
  status: "https://status.claude.com",
  statusLabel: "Official status",
};
const modelIds = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
] as const;

export { provider, modelIds };
