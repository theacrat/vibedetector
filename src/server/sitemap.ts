import { loadProviders } from "./catalogue";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function sitemap(db: D1Database, origin: string): Promise<Response> {
  const providers = await loadProviders(db, true);
  const paths = ["", "privacy", "methodology", ...providers.map((provider) => provider.slug)];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escapeXml(`${origin}/${path}`)}</loc></url>`).join("")}</urlset>`,
    { headers: { "Cache-Control": "no-store", "Content-Type": "application/xml; charset=utf-8" } },
  );
}

export { sitemap };
