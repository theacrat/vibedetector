import type { Category, ProviderId } from "@/domain";
import { isCategory } from "@/domain";

const HOUR = 3_600_000;
interface Report {
  created_at: number;
  category: Category | null;
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

function readReport(row: unknown): Report {
  const category = readCategory(row);
  if (
    !row ||
    typeof row !== "object" ||
    !("created_at" in row) ||
    typeof row.created_at !== "number" ||
    !Number.isFinite(row.created_at)
  ) {
    throw new Error("Invalid stored timestamp");
  }
  return { category, created_at: row.created_at };
}

async function saveReport(
  db: D1Database,
  provider: ProviderId,
  identity: string,
  category: Category | null,
  now: number,
): Promise<Category | null> {
  const row = await db
    .prepare(`INSERT INTO reports (provider, identity_hash, window, created_at, category)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (provider, identity_hash, window) DO UPDATE SET category = excluded.category
    RETURNING category`)
    .bind(provider, identity, Math.floor(now / HOUR), now, category)
    .first<unknown>();
  if (!row) {
    throw new Error("Report write failed");
  }
  return readCategory(row);
}

async function sessionCategory(
  db: D1Database,
  provider: ProviderId,
  identity: string,
  now: number,
): Promise<Category | null> {
  const row = await db
    .prepare("SELECT category FROM reports WHERE provider = ? AND identity_hash = ? AND window = ?")
    .bind(provider, identity, Math.floor(now / HOUR))
    .first<unknown>();
  // SQL NULL represents an absent or retracted report in the API contract.
  // oxlint-disable-next-line unicorn/no-null
  return row === null ? null : readCategory(row);
}

async function loadReports(db: D1Database, provider: ProviderId, now: number): Promise<Report[]> {
  const result = await db
    .prepare(
      "SELECT created_at, category FROM reports WHERE provider = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at",
    )
    .bind(provider, now - 8 * 24 * HOUR, now)
    .all<unknown>();
  if (!result.success) {
    throw new Error("Report read failed");
  }
  return result.results.map(readReport);
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
export { HOUR, loadReports, retainReports, saveReport, sessionCategory };
export type { Report };
