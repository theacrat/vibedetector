import type { Category, ProviderId } from "@/domain";
import { isCategory, isId } from "@/domain";

import { ApiError } from "./security";

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

function readSession(row: unknown): SessionReport {
  const category = readCategory(row);
  if (
    !row ||
    typeof row !== "object" ||
    !("model" in row) ||
    (row.model !== null && !isId(row.model))
  ) {
    throw new Error("Invalid stored model");
  }
  return { category, model: row.model };
}

function readReport(row: unknown): Report {
  const session = readSession(row);
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
  // SQL NULL is the absent-report state.
  // oxlint-disable-next-line unicorn/no-null
  return row === null ? { category: null, model: null } : readSession(row);
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
  if (model !== null && !isId(model)) {
    throw new ApiError(400, "Invalid report model");
  }
  const row = await db
    .prepare(`INSERT INTO reports (provider, identity_hash, window, created_at, category, model)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6
    WHERE EXISTS (SELECT 1 FROM providers WHERE id = ?1 AND active = 1) AND (
      ?6 IS NULL
      OR EXISTS (SELECT 1 FROM models WHERE provider = ?1 AND id = ?6 AND active = 1)
      OR EXISTS (SELECT 1 FROM reports WHERE provider = ?1 AND identity_hash = ?2 AND window = ?3 AND model = ?6 AND (?5 IS NULL OR category IS NOT NULL)))
    ON CONFLICT (provider, identity_hash, window) DO UPDATE SET category = excluded.category, model = excluded.model
    RETURNING category, model`)
    .bind(provider, identity, Math.floor(now / HOUR), now, category, model)
    .first<unknown>();
  if (!row) {
    throw new ApiError(400, "Invalid report model");
  }
  return readSession(row).category;
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
export { HOUR, loadReports, retainReports, saveReport, sessionReport };
export type { Report };
