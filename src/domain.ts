const categories = ["nerfed", "slow", "broken"] as const;
type Category = (typeof categories)[number];
const providers = [
  { id: "claude", maker: "Anthropic", name: "Claude", status: "https://status.claude.com" },
  { id: "chatgpt", maker: "OpenAI", name: "ChatGPT", status: "https://status.openai.com" },
  { id: "gemini", maker: "Google", name: "Gemini", status: "https://aistudio.google.com/status" },
  { id: "copilot", maker: "GitHub", name: "Copilot", status: "https://www.githubstatus.com" },
  { id: "grok", maker: "xAI", name: "Grok", status: "https://status.x.ai" },
  { id: "mistral", maker: "Mistral AI", name: "Mistral", status: "https://status.mistral.ai" },
  { id: "deepseek", maker: "DeepSeek", name: "DeepSeek", status: "https://status.deepseek.com" },
  { id: "cursor", maker: "Anysphere", name: "Cursor", status: "https://status.cursor.com" },
  { id: "zai", maker: "Z.AI", name: "Z.AI", status: "https://z.ai", statusLabel: "Z.AI website" },
  { id: "kimi", maker: "Moonshot AI", name: "Kimi", status: "https://status.moonshot.cn" },
] as const;
type Provider = (typeof providers)[number];
type ProviderId = Provider["id"];
const ranges = {
  "24h": { count: 48, label: "30 min", step: 1_800_000 },
  "6h": { count: 24, label: "15 min", step: 900_000 },
  "7d": { count: 56, label: "3 hrs", step: 10_800_000 },
} as const;
type Range = keyof typeof ranges;
interface Bucket {
  t: number;
  nerfed: number;
  slow: number;
  broken: number;
}
interface Dashboard {
  models: ModelOption[];
  model: string;
  provider: Provider;
  range: Range;
  buckets: Bucket[];
  hourly: number;
  baseline: number | null;
  verdict: "insufficient community data" | "no report spike" | "vibes are off" | "killed the vibe";
  asOf: number;
}
interface ModelOption {
  provider: ProviderId;
  name: string;
  active: boolean;
}
interface Overview {
  provider: Provider;
  hourly: number;
  buckets: Bucket[];
}
function findProvider(id: string) {
  return providers.find((provider) => provider.id === id);
}
function isRange(value: string): value is Range {
  return Object.hasOwn(ranges, value);
}
function isCategory(value: unknown): value is Category {
  return categories.some((category) => category === value);
}
export { categories, providers, ranges, findProvider, isRange, isCategory };
export type { Category, Provider, ProviderId, Range, Bucket, Dashboard, Overview, ModelOption };
