import { scrapeUrl, type OutputFormat, type ScrapeOptions } from "../lib/drazta";
import { bounded, requireUrl, run } from "../lib/respond";

const FORMATS: OutputFormat[] = [
  "markdown",
  "html",
  "rawHtml",
  "links",
  "metadata",
  "json",
];

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) ?? {};

  return run(async () => {
    const url = requireUrl(body.url);
    const asked: unknown[] = Array.isArray(body.formats) ? body.formats : [];
    const formats = FORMATS.filter((f) => asked.includes(f));

    const opts: ScrapeOptions = {
      formats: formats.length ? formats : ["markdown", "metadata"],
      onlyMainContent: body.onlyMainContent === true,
      requiresJs: body.requiresJs === true,
      timeoutMs: bounded(body.timeoutMs, 30_000, 1_000, 120_000),
    };
    if (typeof body.engine === "string" && body.engine) opts.engine = body.engine;
    if (body.waitForMs) opts.waitForMs = bounded(body.waitForMs, 0, 0, 30_000);

    return { document: await scrapeUrl(url, opts) };
  });
});
