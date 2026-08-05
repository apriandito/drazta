import { deepExtract, type DeepExtractResult } from "../lib/drazta";
import { BadInput, bounded, requireUrl, run } from "../lib/respond";

const PREVIEW_ROWS = 300;
const MAX_SOURCES = 40;

/**
 * Many pages, one dataset. `union` stacks rows from pages that share a schema;
 * `join` widens by a key column so one page per year becomes one row per
 * region. A page that yields no table is reported in `sources` with its error
 * and never fails the batch — the console shows those alongside the successes.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) ?? {};

  return run(async () => {
    const merge = body.merge === "join" ? "join" : "union";
    const input = Array.isArray(body.sources) ? body.sources : [];
    if (!input.length) throw new BadInput("add at least one source URL");
    if (input.length > MAX_SOURCES) {
      throw new BadInput(`too many sources: ${input.length} (max ${MAX_SOURCES})`);
    }

    const sources = input.map((src: Record<string, unknown>, i: number) => ({
      url: requireUrl(src?.url, `sources[${i}].url`),
      label: typeof src?.label === "string" && src.label.trim() ? src.label.trim() : undefined,
      tableIndex:
        src?.tableIndex === undefined || src.tableIndex === null || src.tableIndex === ""
          ? undefined
          : bounded(src.tableIndex, 0, 0, 200),
    }));

    if (merge === "join" && !body.key) {
      throw new BadInput('join needs a key — a column name, or "@first"');
    }

    const result: DeepExtractResult = await deepExtract(sources, {
      merge,
      key: merge === "join" ? String(body.key) : undefined,
      sourceColumn:
        merge === "union" && typeof body.sourceColumn === "string" && body.sourceColumn.trim()
          ? body.sourceColumn.trim()
          : undefined,
      concurrency: bounded(body.concurrency, 4, 1, 12),
      tidy: { snakeCase: body.snakeCase === true },
    });

    return {
      merge: result.merge,
      matchedKeys: result.matchedKeys ?? null,
      sources: result.sources,
      table: {
        caption: result.table.caption,
        columns: result.table.columns,
        rowCount: result.table.rowCount,
        rows: result.table.rows.slice(0, PREVIEW_ROWS),
        truncated: result.table.rowCount > PREVIEW_ROWS,
      },
      previewRows: PREVIEW_ROWS,
    };
  });
});
