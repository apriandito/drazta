import type { ScrapeOptions } from "../types.js";

/**
 * Whether a browser engine should hide its window.
 *
 * Per-request wins over the environment, so a debugging session can be opted
 * into globally (DRAZTA_HEADLESS=0) while a specific scrape still forces one
 * mode or the other.
 */
export function resolveHeadless(opts: ScrapeOptions): boolean {
  if (typeof opts.headless === "boolean") return opts.headless;
  if (process.env.DRAZTA_HEADLESS === "0") return false;
  return true;
}
