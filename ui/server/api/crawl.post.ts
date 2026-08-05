import { crawl } from "../lib/drazta";
import { bounded, requireUrl, run } from "../lib/respond";

/**
 * Same-site breadth-first crawl. Only the metadata of each page travels back —
 * a 30-page crawl of full markdown would be megabytes the console never shows.
 * Errors come back too: a crawl that half-failed should look half-failed.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) ?? {};

  return run(async () => {
    const url = requireUrl(body.url);

    const { documents, errors } = await crawl(url, {
      limit: bounded(body.limit, 20, 1, 200),
      maxDepth: bounded(body.maxDepth, 2, 0, 6),
      concurrency: bounded(body.concurrency, 5, 1, 12),
      prefix: typeof body.prefix === "string" && body.prefix.trim() ? body.prefix.trim() : undefined,
      sameSiteOnly: body.sameSiteOnly !== false,
      scrapeOptions: {
        onlyMainContent: body.onlyMainContent === true,
        timeoutMs: bounded(body.timeoutMs, 30_000, 1_000, 120_000),
      },
    });

    const pages = documents.map((doc) => ({
      url: doc.metadata.url,
      title: doc.metadata.title ?? null,
      statusCode: doc.metadata.statusCode ?? null,
      engine: doc.metadata.engine ?? null,
      textLength: doc.metadata.textLength ?? null,
      publishedDate: doc.metadata.publishedDate ?? null,
      degraded: doc.metadata.degraded ?? null,
    }));

    return {
      pages,
      errors,
      degradedCount: pages.filter((p) => p.degraded).length,
    };
  });
});
