import {
  FEATURE_PRIORITY,
  type FeatureFlag,
  type FetchEngine,
} from "../core/ports.js";
import type { ScrapeOptions } from "../types.js";
import { fetchEngine } from "./fetch.js";
import { closeBrowser, playwrightEngine } from "./playwright.js";

/**
 * Releases every resource the engines hold — today that is the shared browser.
 * Call it before a short-lived program exits; without it, a process that
 * scraped a JS-rendered page stays alive holding an idle Chromium.
 */
export async function shutdownEngines(): Promise<void> {
  await closeBrowser();
}

/**
 * The engine registry. To add an engine (pdf, wikipedia, an external browser
 * service, ...) register it here and declare its feature matrix — routing is
 * computed, so nothing else in the system changes.
 */
export const engines: FetchEngine[] = [fetchEngine, playwrightEngine];

/** Translates request options into the capabilities they imply. */
export function requiredFeatures(opts: ScrapeOptions): Set<FeatureFlag> {
  const flags = new Set<FeatureFlag>();
  if (opts.requiresJs) flags.add("javascript");
  if (opts.waitForMs) flags.add("waitFor");
  for (const f of opts.features ?? []) flags.add(f);
  return flags;
}

export interface EngineChoice {
  engine: FetchEngine;
  supportScore: number;
  /** What this engine cannot do for this request — useful for logging. */
  unsupported: FeatureFlag[];
}

/**
 * Ranks engines for one request.
 *
 * Each required capability carries a priority. An engine's supportScore is the
 * sum of the priorities it satisfies; anything scoring below half the total
 * demand is dropped as unfit. Survivors sort by supportScore, then by quality.
 *
 * With no requirements every engine scores 0 and the order is pure quality —
 * cheapest-and-best first, which is the common case.
 */
export function buildFallbackList(
  url: string,
  opts: ScrapeOptions,
  extraFeatures: Iterable<FeatureFlag> = [],
): EngineChoice[] {
  if (opts.engine) {
    const forced = engines.find((e) => e.name === opts.engine);
    if (!forced) throw new Error(`Unknown engine: ${opts.engine}`);
    return [{ engine: forced, supportScore: 0, unsupported: [] }];
  }

  const required = requiredFeatures(opts);
  for (const f of extraFeatures) required.add(f);

  const demand = [...required].reduce((a, f) => a + FEATURE_PRIORITY[f], 0);
  const threshold = Math.floor(demand / 2);

  const scored: EngineChoice[] = [];
  for (const engine of engines) {
    let supportScore = 0;
    const unsupported: FeatureFlag[] = [];
    for (const flag of required) {
      if (engine.features[flag]) supportScore += FEATURE_PRIORITY[flag];
      else unsupported.push(flag);
    }
    if (supportScore >= threshold) {
      scored.push({ engine, supportScore, unsupported });
    }
  }

  scored.sort(
    (a, b) => b.supportScore - a.supportScore || b.engine.quality - a.engine.quality,
  );
  return scored;
}
