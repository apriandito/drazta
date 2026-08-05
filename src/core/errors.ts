/**
 * The error taxonomy.
 *
 * A scraper's fallback chain is only as good as its ability to tell "this
 * engine couldn't do it" apart from "nobody can do it". Collapsing every
 * failure into one string means a dead domain still pays for a browser launch,
 * and a Cloudflare wall gets retried by an engine that will hit the same wall.
 *
 * Every error here answers one question: `fatal`. Fatal means no other engine
 * will do better, so the waterfall stops immediately.
 */

export abstract class ScrapeError extends Error {
  /** True when trying another engine cannot possibly help. */
  abstract readonly fatal: boolean;
  constructor(
    message: string,
    public readonly url?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The hostname does not resolve. No engine can invent a DNS record. */
export class DNSError extends ScrapeError {
  readonly fatal = true;
}

/** TLS handshake failed (bad/expired/self-signed cert). */
export class SSLError extends ScrapeError {
  readonly fatal = true;
}

/** The host resolved but refused or dropped the connection. */
export class SiteError extends ScrapeError {
  readonly fatal = true;
}

/** The request exceeded its time budget. Another engine may still be faster. */
export class TimeoutError extends ScrapeError {
  readonly fatal = false;
}

/**
 * An engine looked at the response and declined it. Fatality is not inherent
 * to the class — a 404 and a Cloudflare wall are both "rejected", but only one
 * of them is worth handing to a stronger engine — so the inspecting code
 * supplies the verdict rather than the type implying it.
 */
export class PageRejectedError extends ScrapeError {
  constructor(
    message: string,
    url: string | undefined,
    public readonly reason: string,
    public readonly fatal: boolean,
  ) {
    super(message, url);
  }
}

/**
 * The body was not a web page (PDF, image, archive). Fatal by design: no
 * engine turns a JPEG into an article, so escalating only wastes a browser.
 */
export class UnsupportedContentError extends ScrapeError {
  readonly fatal = true;
  constructor(
    url: string,
    public readonly contentType: string,
  ) {
    super(`Unsupported content type for ${url}: ${contentType}`, url);
  }
}

/**
 * The URL resolved to a private/loopback/link-local address. Refusing is the
 * whole point — a scraper that accepts arbitrary URLs is otherwise an SSRF
 * proxy into whatever network it runs on.
 */
export class BlockedAddressError extends ScrapeError {
  readonly fatal = true;
  constructor(
    url: string,
    public readonly address: string,
  ) {
    super(`Refusing to fetch ${url}: resolves to non-public address ${address}`, url);
  }
}

/** No engine in the fallback list produced a usable result. */
export class NoEnginesLeftError extends ScrapeError {
  readonly fatal = true;
  constructor(
    url: string,
    public readonly attempts: { engine: string; error: string }[],
  ) {
    super(
      `All engines failed for ${url}: ` +
        attempts.map((a) => `${a.engine}(${a.error})`).join(", "),
      url,
    );
  }
}

/**
 * Not a failure — a request to re-plan. An engine (or the quality gate) throws
 * this when it learns something that changes which engine should have run:
 * a 403 means "we need stealth", a JS shell means "we need a browser".
 *
 * scrapeUrl catches it, adds the flags, and rebuilds the fallback list from
 * scratch. This is what turns detection into action; without it, "escalate"
 * only ever means "try whatever happens to be next in the list".
 */
export class AddFeatureError extends ScrapeError {
  readonly fatal = false;
  constructor(
    public readonly features: string[],
    public readonly why: string,
  ) {
    super(`Re-planning with features [${features.join(", ")}]: ${why}`);
  }
}

/** Node's fetch buries the real cause; dig it out. */
function causeCode(err: unknown): string {
  const e = err as { cause?: { code?: string }; code?: string };
  return e?.cause?.code ?? e?.code ?? "";
}

/**
 * Maps a thrown transport error onto the taxonomy. Anything unrecognized is
 * left alone rather than guessed at — mislabeling a transient failure as fatal
 * would silently kill the fallback chain.
 */
export function classifyFetchError(err: unknown, url: string): unknown {
  if (err instanceof ScrapeError) return err;

  const code = causeCode(err);
  const message = err instanceof Error ? err.message : String(err);

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new DNSError(`DNS lookup failed for ${url} (${code})`, url);
  }
  if (code.startsWith("CERT_") || code.startsWith("ERR_TLS") || code === "EPROTO") {
    return new SSLError(`TLS failure for ${url} (${code})`, url);
  }
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH"
  ) {
    return new SiteError(`Connection failed for ${url} (${code})`, url);
  }
  if (
    code === "ABORT_ERR" ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    (err as Error)?.name === "AbortError" ||
    (err as Error)?.name === "TimeoutError"
  ) {
    return new TimeoutError(`Timed out fetching ${url}`, url);
  }

  return new Error(message, { cause: err });
}
