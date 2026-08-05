import type { FetchEngine } from "../core/ports.js";
import type { RawResult, ScrapeOptions } from "../types.js";
import { safeFetch } from "../lib/safeFetch.js";

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; ScrapeFlow/0.1; +https://example.invalid/bot)";

/**
 * The cheapest engine: a plain HTTP GET, which handles the majority of
 * static/SSR pages. Goes through safeFetch, so it inherits per-hop SSRF checks
 * and a cookie jar that survives consent/session redirect chains.
 *
 * It provides no JavaScript, no stealth and no screenshots — declared honestly
 * below, which is what lets the registry route around it instead of trying it
 * and watching it fail.
 */
export const fetchEngine: FetchEngine = {
  name: "fetch",

  features: {
    javascript: false,
    stealth: false,
    screenshot: false,
    waitFor: false,
    cookies: true,
    location: false,
  },

  quality: 100,

  maxReasonableTime(opts: ScrapeOptions): number {
    // A plain GET that hasn't answered in a few seconds is unlikely to beat
    // starting the browser alongside it.
    return Math.min(opts.timeoutMs ?? 30_000, 8_000);
  },

  async fetch(
    url: string,
    opts: ScrapeOptions,
    signal?: AbortSignal,
  ): Promise<RawResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
    // Losing the hedging race stops this request immediately, instead of
    // holding a socket open for a result nobody will read.
    const combined = signal
      ? AbortSignal.any([controller.signal, signal])
      : controller.signal;

    try {
      const { response, finalUrl } = await safeFetch(url, {
        signal: combined,
        headers: {
          "user-agent": DEFAULT_UA,
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "id-ID,id;q=0.9,en;q=0.8",
          ...opts.headers,
        },
      });

      return {
        rawHtml: await response.text(),
        statusCode: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        resolvedUrl: finalUrl,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};
