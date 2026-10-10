const categories = ["nerfed", "slow", "broken"] as const;
type Category = (typeof categories)[number];
type ProviderId = string;
interface Provider {
  id: ProviderId;
  slug: string;
  name: string;
  maker: string;
  status: string;
  statusLabel: string;
  logo: string;
  active: boolean;
}
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
  id: string;
  provider: ProviderId;
  name: string;
  active: boolean;
}
interface SessionReport {
  category: Category | null;
  model: string | null;
  savedModel?: ModelOption;
}
interface Overview {
  provider: Provider;
  hourly: number;
  buckets: Bucket[];
}
function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value)
  );
}
function isRange(value: string): value is Range {
  return Object.hasOwn(ranges, value);
}
function isCategory(value: unknown): value is Category {
  return categories.some((category) => category === value);
}
export { categories, ranges, isId, isRange, isCategory };
export { catalogueScope } from "./catalogue-scope";
export type {
  Category,
  Provider,
  ProviderId,
  Range,
  Bucket,
  Dashboard,
  Overview,
  ModelOption,
  SessionReport,
};
