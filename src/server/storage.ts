import type { Category, ProviderId } from "@/domain";
import { isCategory, isProviderModel } from "@/domain";

const HOUR = 3_600_000;
interface Report {
  created_at: number;
  category: Category | null;
  model?: string | null;
}
interface SessionReport {
  category: Category | null;
  model: string | null;
}

function readCategory(row: unknown): Category | null {
  if (
    !row ||
    typeof row !== "object" ||
    !("category" in row) ||
    (row.category !== null && !isCategory(row.category))
  ) {
    throw new Error("Invalid stored category");
  }
  return row.category;
}

function readSession(row: unknown, provider: ProviderId): SessionReport {
  const category = readCategory(row);
  if (
    !row ||
    typeof row !== "object" ||
    !("model" in row) ||
    (row.model !== null && !isProviderModel(provider, row.model))
  ) {
    throw new Error("Invalid stored model");
  }
  return { category, model: row.model };
}

function readReport(row: unknown, provider: ProviderId): Report {
  const session = readSession(row, provider);
  if (
    !row ||
    typeof row !== "object" ||
    !("created_at" in row) ||
    typeof row.created_at !== "number" ||
    !Number.isFinite(row.created_at)
  ) {
    throw new Error("Invalid stored timestamp");
  }
  return { ...session, created_at: row.created_at };
}

async function saveReport(
  db: D1Database,
  provider: ProviderId,
  identity: string,
  category: Category | null,
  now: number,
  // SQL NULL is the metadata default for older clients.
  // oxlint-disable-next-line unicorn/no-null
  model: string | null = null,
): Promise<Category | null> {
  if (model !== null && !isProviderModel(provider, model)) {
    throw new Error("Invalid report model");
  }
  const row = await db
    .prepare(`INSERT INTO reports (provider, identity_hash, window, created_at, category, model)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (provider, identity_hash, window) DO UPDATE SET category = excluded.category, model = excluded.model
    RETURNING category, model`)
    .bind(provider, identity, Math.floor(now / HOUR), now, category, model)
    .first<unknown>();
  if (!row) {
    throw new Error("Report write failed");
  }
  return readSession(row, provider).category;
}

async function sessionReport(
  db: D1Database,
  provider: ProviderId,
  identity: string,
  now: number,
): Promise<SessionReport> {
  const row = await db
    .prepare(
      "SELECT category, model FROM reports WHERE provider = ? AND identity_hash = ? AND window = ?",
    )
    .bind(provider, identity, Math.floor(now / HOUR))
    .first<unknown>();
  // SQL NULL represents an absent or retracted report in the API contract.
  // oxlint-disable-next-line unicorn/no-null
  return row === null ? { category: null, model: null } : readSession(row, provider);
}

async function loadReports(db: D1Database, provider: ProviderId, now: number): Promise<Report[]> {
  const result = await db
    .prepare(
      "SELECT created_at, category, model FROM reports WHERE provider = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at",
    )
    .bind(provider, now - 8 * 24 * HOUR, now)
    .all<unknown>();
  if (!result.success) {
    throw new Error("Report read failed");
  }
  return result.results.map((row) => readReport(row, provider));
}

async function retainReports(db: D1Database, now: number): Promise<void> {
  while (true) {
    // Each indexed deletion is bounded; sequential batches drain the privacy backlog.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const result = await db
      .prepare(`DELETE FROM reports WHERE (provider, identity_hash, window) IN
    (SELECT provider, identity_hash, window FROM reports WHERE created_at < ? ORDER BY created_at LIMIT 5000)`)
      .bind(now - 8 * 24 * HOUR)
      .run();
    if (!result.success) {
      throw new Error("Retention failed");
    }
    if (result.meta.changes < 5000) {
      break;
    }
  }
}
export { HOUR, loadReports, retainReports, saveReport, sessionReport };
export type { Report };
