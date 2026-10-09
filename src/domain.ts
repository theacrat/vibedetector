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
  model: string;
  provider: Provider;
  range: Range;
  buckets: Bucket[];
  hourly: number;
  baseline: number | null;
  verdict: "insufficient community data" | "no report spike" | "vibes are off" | "killed the vibe";
  asOf: number;
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
const providerModels: Record<ProviderId, readonly string[]> = {
  chatgpt: ["GPT-6.1 Sol", "GPT-6 Sol", "GPT-6 Luna", "GPT-5.6 Sol", "GPT-5.5", "GPT-5.4", "o3"],
  claude: [
    "Claude Opus 5.5",
    "Claude Sonnet 5.5",
    "Claude Haiku 5.5",
    "Claude Opus 4.7",
    "Claude Sonnet 4.6",
    "Claude Haiku 4.5",
  ],
  copilot: [
    "GPT-6.1 Sol",
    "GPT-6 Sol",
    "Claude Opus 5.5",
    "Claude Sonnet 5.5",
    "Gemini 3.8 Flash",
    "Grok 4.7",
  ],
  cursor: [
    "Auto",
    "Composer",
    "Claude Opus 5.5",
    "Claude Sonnet 5.5",
    "GPT-6.1 Sol",
    "Gemini 3.8 Flash",
  ],
  deepseek: ["DeepSeek V4.1 Flash", "DeepSeek V4 Pro", "DeepSeek V4 Flash"],
  gemini: [
    "Gemini 3.8 Flash",
    "Gemini 3.7 Flash",
    "Gemini 3.5 Flash",
    "Gemini 3.1 Pro",
    "Gemini 2.5 Pro",
    "Gemini 2.5 Flash",
  ],
  grok: ["Grok 4.7", "Grok 4.6", "Grok 4.5", "Grok 4.3"],
  kimi: ["Kimi K3", "Kimi K2.7 Code", "Kimi K2.6", "Kimi K2.5", "Kimi K2"],
  mistral: [
    "Mistral Large 4",
    "Mistral Medium 3.5",
    "Mistral Small 3.2",
    "Codestral 25.08",
    "Devstral Small",
  ],
  zai: ["GLM-5.3", "GLM-5.2", "GLM-5.1", "GLM-5", "GLM-4.7", "GLM-4.7-Flash"],
};
function isProviderModel(provider: ProviderId, value: unknown): value is string {
  return typeof value === "string" && providerModels[provider].includes(value);
}
function isModelFilter(provider: ProviderId, value: unknown): value is string {
  return value === "" || value === "unspecified" || isProviderModel(provider, value);
}
export {
  categories,
  providers,
  ranges,
  findProvider,
  isRange,
  isCategory,
  providerModels,
  isProviderModel,
  isModelFilter,
};
export type { Category, Provider, ProviderId, Range, Bucket, Dashboard, Overview };
