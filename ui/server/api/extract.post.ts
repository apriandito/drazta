import { extractArticle, extractProduct, scrapeUrl } from "../lib/drazta";
import { BadInput, bounded, requireUrl, run } from "../lib/respond";

/**
 * Article and product extraction. Both are deterministic — JSON-LD, then
 * OpenGraph/meta, then readability for the body — and both report a `sources`
 * map naming the layer that produced each field. The console renders that map,
 * so nothing here needs to summarise or soften it.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) ?? {};

  return run(async () => {
    const url = requireUrl(body.url);
    const kind = body.kind === "product" ? "product" : body.kind === "article" ? "article" : null;
    if (!kind) throw new BadInput('kind must be "article" or "product"');

    // rawHtml is what the extractors read; markdown comes along so the console
    // can show the cleaned body next to the structured record.
    const doc = await scrapeUrl(url, {
      formats: ["rawHtml", "markdown", "metadata"],
      requiresJs: body.requiresJs === true,
      timeoutMs: bounded(body.timeoutMs, 30_000, 1_000, 120_000),
    });

    const record = kind === "article" ? extractArticle(doc) : extractProduct(doc);
    return { kind, record, metadata: doc.metadata, markdown: doc.markdown ?? null };
  });
});
