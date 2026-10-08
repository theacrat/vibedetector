export const categories = ['nerfed', 'slow', 'broken'] as const;
export type Category = (typeof categories)[number];
export const providers = [
  { id: 'claude', name: 'Claude', maker: 'Anthropic', status: 'https://status.claude.com' },
  { id: 'chatgpt', name: 'ChatGPT', maker: 'OpenAI', status: 'https://status.openai.com' },
  { id: 'gemini', name: 'Gemini', maker: 'Google', status: 'https://aistudio.google.com/status' },
  { id: 'copilot', name: 'Copilot', maker: 'GitHub', status: 'https://www.githubstatus.com' },
  { id: 'grok', name: 'Grok', maker: 'xAI', status: 'https://status.x.ai' },
  { id: 'mistral', name: 'Mistral', maker: 'Mistral AI', status: 'https://status.mistral.ai' },
  { id: 'deepseek', name: 'DeepSeek', maker: 'DeepSeek', status: 'https://status.deepseek.com' },
  { id: 'cursor', name: 'Cursor', maker: 'Anysphere', status: 'https://status.cursor.com' },
] as const;
export type Provider = (typeof providers)[number];
export type ProviderId = Provider['id'];
export const ranges = {
  '6h': { count: 24, step: 900_000, label: '15 min' },
  '24h': { count: 48, step: 1_800_000, label: '30 min' },
  '7d': { count: 56, step: 10_800_000, label: '3 hrs' },
} as const;
export type Range = keyof typeof ranges;
export type Bucket = { t: number; nerfed: number; slow: number; broken: number };
export type Dashboard = {
  provider: Provider;
  range: Range;
  buckets: Bucket[];
  hourly: number;
  baseline: number | null;
  verdict: 'insufficient community data' | 'no report spike' | 'vibes are off' | 'killed the vibe';
  asOf: number;
};
export type Overview = { provider: Provider; hourly: number; buckets: Bucket[] };
export function findProvider(id: string) { return providers.find((provider) => provider.id === id); }
export function isRange(value: string): value is Range { return Object.hasOwn(ranges, value); }
export function isCategory(value: unknown): value is Category { return categories.some((category) => category === value); }
