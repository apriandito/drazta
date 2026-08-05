import {
  buildFallbackList,
  engines,
  requiredFeatures,
  FEATURE_PRIORITY,
  type FeatureFlag,
  type ScrapeOptions,
} from "../lib/drazta";
import { bounded, run } from "../lib/respond";

/**
 * The routing plan for a request — before it runs.
 *
 * This is Drazta's most distinctive mechanism and the least visible one: a
 * request is translated into the capabilities it needs, every engine is scored
 * on how much of that demand it covers, anything below half is dropped, and the
 * survivors race in order. The console shows the real list from
 * `buildFallbackList`, so toggling an option visibly re-plans the waterfall.
 *
 * Engines the scorer dropped are reported separately with the required
 * capabilities they lack — read straight off each engine's feature matrix, the
 * same data the scorer used.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) ?? {};

  return run(async () => {
    const opts: ScrapeOptions = {
      requiresJs: body.requiresJs === true,
      timeoutMs: bounded(body.timeoutMs, 30_000, 1_000, 120_000),
    };
    if (body.waitForMs) opts.waitForMs = bounded(body.waitForMs, 0, 0, 30_000);
    if (typeof body.engine === "string" && body.engine) opts.engine = body.engine;

    const required = [...requiredFeatures(opts)];
    const demand = required.reduce((sum, f) => sum + FEATURE_PRIORITY[f], 0);

    // The engine name is caller-supplied; an unknown one throws by design.
    const chosen = buildFallbackList("https://example.com", opts);
    const planned = new Set(chosen.map((c) => c.engine.name));

    return {
      required,
      demand,
      threshold: Math.floor(demand / 2),
      forced: Boolean(opts.engine),
      plan: chosen.map((choice, i) => ({
        position: i + 1,
        name: choice.engine.name,
        quality: choice.engine.quality,
        supportScore: choice.supportScore,
        unsupported: choice.unsupported,
        covers: (Object.keys(choice.engine.features) as FeatureFlag[]).filter(
          (f) => choice.engine.features[f],
        ),
      })),
      dropped: engines
        .filter((engine) => !planned.has(engine.name))
        .map((engine) => ({
          name: engine.name,
          quality: engine.quality,
          lacks: required.filter((f) => !engine.features[f]),
        })),
    };
  });
});
