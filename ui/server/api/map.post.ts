import { mapSite } from "../lib/drazta";
import { bounded, requireUrl, run } from "../lib/respond";

/**
 * Sitemap-first discovery. Each entry says whether it came from a sitemap
 * (authoritative) or from harvesting the homepage's links (a guess), and the
 * console keeps that distinction visible.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) ?? {};

  return run(async () => {
    const url = requireUrl(body.url);
    const entries = await mapSite(url, {
      limit: bounded(body.limit, 100, 1, 2000),
      prefix: typeof body.prefix === "string" && body.prefix.trim() ? body.prefix.trim() : undefined,
      includeSeedLinks: body.includeSeedLinks !== false,
      timeoutMs: bounded(body.timeoutMs, 15_000, 1_000, 60_000),
    });

    const fromSitemap = entries.filter((e) => e.source === "sitemap").length;
    return {
      entries,
      total: entries.length,
      fromSitemap,
      fromLinks: entries.length - fromSitemap,
    };
  });
});
