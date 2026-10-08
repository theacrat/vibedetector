import type { Category, ProviderId } from "../domain";

export const HOUR = 3_600_000;
export interface Report {
  created_at: number;
  category: Category | null;
}

export async function saveReport(
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
    .first<{ category: Category | null }>();
  if (!row) {
    throw new Error("Report write failed");
  }
  return row.category;
}

export async function sessionCategory(
  db: D1Database,
  provider: ProviderId,
  identity: string,
  now: number,
): Promise<Category | null> {
  const row = await db
    .prepare("SELECT category FROM reports WHERE provider = ? AND identity_hash = ? AND window = ?")
    .bind(provider, identity, Math.floor(now / HOUR))
    .first<{ category: Category | null }>();
  return row?.category ?? null;
}

export async function loadReports(
  db: D1Database,
  provider: ProviderId,
  now: number,
): Promise<Report[]> {
  const result = await db
    .prepare(
      "SELECT created_at, category FROM reports WHERE provider = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at",
    )
    .bind(provider, now - 8 * 24 * HOUR, now)
    .all<Report>();
  if (!result.success) {
    throw new Error("Report read failed");
  }
  return result.results;
}

export async function retainReports(db: D1Database, now: number): Promise<void> {
  const result = await db
    .prepare(`DELETE FROM reports WHERE (provider, identity_hash, window) IN
    (SELECT provider, identity_hash, window FROM reports WHERE created_at < ? ORDER BY created_at LIMIT 5000)`)
    .bind(now - 8 * 24 * HOUR)
    .run();
  if (!result.success) {
    throw new Error("Retention failed");
  }
}
