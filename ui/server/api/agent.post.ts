import { runAgent } from "../lib/drazta";
import { BadInput, bounded, run } from "../lib/respond";

/** Guard the response size — a workbook is fine, a 200 MB one is not. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * The agentic path: a natural-language task, planned by the model, executed by
 * the same map/scrape/extract/export tools the rest of this console calls
 * directly. Files come back inline as base64 so the browser can save them
 * without a second round trip.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) ?? {};

  return run(async () => {
    const task = typeof body.task === "string" ? body.task.trim() : "";
    if (!task) throw new BadInput("describe the task in a sentence");
    if (!process.env.OPENAI_API_KEY) {
      throw new BadInput("OPENAI_API_KEY is not set — the agent cannot run");
    }

    const result = await runAgent({
      task,
      maxSteps: bounded(body.maxSteps, 12, 1, 30),
    });

    const files = result.files.map((file) => ({
      name: file.name,
      size: file.bytes.byteLength,
      // Oversized artifacts are reported but not shipped; the console says so.
      base64:
        file.bytes.byteLength <= MAX_FILE_BYTES ? file.bytes.toString("base64") : null,
    }));

    return {
      text: result.text,
      records: result.records,
      recordCount: result.records.length,
      files,
      maxFileBytes: MAX_FILE_BYTES,
    };
  });
});
