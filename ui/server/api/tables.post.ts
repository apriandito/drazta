import { extractTables, scrapeUrl, tidyTable } from "../lib/drazta";
import { bounded, requireUrl, run } from "../lib/respond";

/** How many rows travel to the browser per table. The full count is reported. */
const PREVIEW_ROWS = 200;

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) ?? {};

  return run(async () => {
    const url = requireUrl(body.url);
    const snakeCase = body.snakeCase === true;

    const doc = await scrapeUrl(url, {
      formats: ["rawHtml", "metadata"],
      requiresJs: body.requiresJs === true,
      timeoutMs: bounded(body.timeoutMs, 30_000, 1_000, 120_000),
    });

    const raw = extractTables(doc, {
      minRows: bounded(body.minRows, 2, 1, 100),
      minCols: bounded(body.minCols, 2, 1, 100),
    });

    const tables = raw.map((table, index) => {
      const tidy = tidyTable(table, { snakeCase });
      return {
        index,
        caption: tidy.caption,
        columns: tidy.columns,
        rowCount: tidy.rowCount,
        colCount: table.colCount,
        // Truncated for transport; rowCount above is the real number.
        rows: tidy.rows.slice(0, PREVIEW_ROWS),
        truncated: tidy.rowCount > PREVIEW_ROWS,
      };
    });

    return { tables, previewRows: PREVIEW_ROWS, metadata: doc.metadata };
  });
});
