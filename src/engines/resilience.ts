import type { Document, RawResult } from "../types.js";

/** Retry an async op with exponential backoff. Only retries on thrown errors. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: {
    retries?: number;
    baseDelayMs?: number;
    onRetry?: (e: unknown, attempt: number) => void;
    /**
     * Decides whether an error is worth another attempt. Retrying a dead DNS
     * record or a refused connection just multiplies the wait by three before
     * failing identically — the caller knows which errors those are.
     */
    shouldRetry?: (e: unknown) => boolean;
  } = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 400;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      if (opts.shouldRetry && !opts.shouldRetry(err)) break;
      opts.onRetry?.(err, attempt);
      await new Promise((r) => setTimeout(r, base * 2 ** attempt));
    }
  }
  throw lastErr;
}

// Precise interstitial signatures. These must indicate the page IS a challenge,
// not merely mention a word — a real article containing "captcha" in some edit
// link must NOT be flagged (that was a real false positive on Wikipedia).
const BLOCK_SIGNATURES: { pattern: RegExp; reason: string }[] = [
  { pattern: /just a moment\.\.\./i, reason: "cloudflare-challenge" },
  { pattern: /cf-browser-verification|cf_chl_opt|__cf_chl/i, reason: "cloudflare-challenge" },
  { pattern: /attention required!.*cloudflare/is, reason: "cloudflare-block" },
  { pattern: /please (complete|verify|solve)[^.]{0,30}captcha|captcha[^.]{0,20}(to continue|to verify)|are you a (human|robot)/i, reason: "captcha" },
  { pattern: /access denied|you have been blocked|request (was )?blocked|blocked by/i, reason: "access-denied" },
  { pattern: /enable javascript and cookies to continue|please enable cookies/i, reason: "js-wall" },
];

/** Approximate visible-text length (tags stripped). */
function visibleTextLength(html: string): number {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

/**
 * Heuristic: does this look like an anti-bot interstitial rather than content?
 * A content-rich page (lots of visible text) is never a block, even if a block
 * keyword appears somewhere in its markup — interstitials are short.
 */
export function detectBlock(html: string): string | null {
  if (visibleTextLength(html) > 3000) return null; // substantial content = real page
  const head = html.slice(0, 6000);
  for (const { pattern, reason } of BLOCK_SIGNATURES) {
    if (pattern.test(head)) return reason;
  }
  return null;
}

export interface Verdict {
  ok: boolean;
  reason?: string;
  /** True when the failure is worth escalating to the next (heavier) engine. */
  escalate?: boolean;
}

/**
 * Decides whether an engine result is usable. Beyond HTTP status, it rejects
 * empty bodies and anti-bot walls — those should fall through to a stronger
 * engine instead of being returned as "the page".
 */
export function evaluateResult(raw: RawResult, minChars = 200): Verdict {
  if (raw.statusCode && raw.statusCode >= 400) {
    return { ok: false, reason: `http-${raw.statusCode}`, escalate: raw.statusCode !== 404 };
  }
  const html = raw.rawHtml ?? "";
  if (html.trim().length === 0) {
    return { ok: false, reason: "empty-body", escalate: true };
  }
  const block = detectBlock(html);
  if (block) {
    return { ok: false, reason: block, escalate: true };
  }
  // Very short HTML with no <body> content is suspicious for JS-only pages.
  const textish = html.replace(/<[^>]+>/g, "").trim();
  if (textish.length < minChars && /<div id="(root|app|__next)"/i.test(html)) {
    return { ok: false, reason: "js-shell", escalate: true };
  }
  return { ok: true };
}

/**
 * Content types we can never turn into text. Detected so the pipeline refuses
 * them with a clear error instead of running an HTML parser over binary and
 * emitting confident garbage — the worst possible failure mode for a scraper
 * whose output feeds an LLM.
 */
const UNSUPPORTED_TYPE_PREFIXES = [
  "image/",
  "video/",
  "audio/",
  "font/",
  "application/pdf",
  "application/zip",
  "application/x-tar",
  "application/gzip",
  "application/x-rar",
  "application/x-7z",
  "application/octet-stream",
  "application/wasm",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.oasis.opendocument",
  "application/msword",
  "application/vnd.ms-excel",
];

/**
 * Leading bytes that identify a binary format regardless of what the server
 * claims in Content-Type — servers mislabel far more often than you'd hope.
 *
 * Only ASCII-safe signatures are listed: engines hand us a string already
 * decoded as UTF-8, so any signature containing a non-ASCII byte (PNG's 0x89,
 * JPEG's 0xFF, OLE's 0xD0) is destroyed by that decode before we see it. Those
 * are caught by the replacement-character check in looksBinary() instead.
 */
const MAGIC_SIGNATURES: { prefix: string; type: string }[] = [
  { prefix: "%PDF-", type: "application/pdf" },
  { prefix: "PK\x03\x04", type: "application/zip" },
  { prefix: "GIF8", type: "image/gif" },
  { prefix: "RIFF", type: "image/webp" },
  { prefix: "\x7fELF", type: "application/x-executable" },
];

/**
 * UTF-8 decoding turns every invalid byte into U+FFFD. A body dense with them
 * in its first block was binary before it reached us — this is what catches
 * PNG/JPEG/OLE, whose signatures cannot survive the decode.
 */
function looksBinary(s: string): boolean {
  const head = s.slice(0, 512);
  if (head.length < 16) return false;
  let bad = 0;
  for (const ch of head) {
    if (ch === "\uFFFD" || ch === "\u0000") bad++;
  }
  return bad / head.length > 0.05;
}

/**
 * Decides whether a raw result is something other than a web page. Checks the
 * declared type first, then the actual leading bytes — a URL ending in `.pdf`
 * served as `application/octet-stream` is caught by the second check.
 *
 * Returns the offending media type, or null when the body looks like a page.
 */
export function detectUnsupportedContent(raw: RawResult): string | null {
  const declared = (raw.contentType ?? "").toLowerCase().split(";")[0].trim();
  if (declared) {
    // octet-stream is a "don't know" answer — only reject it if the bytes
    // confirm it, which the magic check below does.
    if (
      declared !== "application/octet-stream" &&
      UNSUPPORTED_TYPE_PREFIXES.some((p) => declared.startsWith(p))
    ) {
      return declared;
    }
  }

  const head = raw.rawHtml.slice(0, 8);
  for (const { prefix, type } of MAGIC_SIGNATURES) {
    if (head.startsWith(prefix)) return type;
  }

  if (looksBinary(raw.rawHtml)) return declared || "application/octet-stream";

  return null;
}

/**
 * Judges an already-parsed document, which is where quality is actually
 * visible. A page can be 200 OK with 60 KB of HTML and still carry no article
 * — nav, scripts and boilerplate weigh a lot. Checking the extracted text is
 * the only way to tell the difference, so this runs AFTER the pipeline and
 * decides whether to escalate to a stronger engine.
 */
export function evaluateDocument(doc: Document, minChars = 200): Verdict {
  const text = (
    doc.markdown ??
    (doc.html ?? doc.rawHtml ?? "").replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();

  // Block pages survive HTML→markdown as a short, recognizable sentence.
  if (text.length > 0) {
    const block = detectBlock(text);
    if (block) {
      return { ok: false, reason: `${block}-after-parse`, escalate: true };
    }
  }

  // The requested formats may not include any body field (e.g. formats:
  // ["links"], where coerceFormats strips markdown/html). The pipeline records
  // how much text it actually saw, so quality is still measurable.
  const length =
    text.length > 0
      ? text.length
      : typeof doc.metadata.textLength === "number"
        ? doc.metadata.textLength
        : 0;

  if (length === 0) {
    return { ok: false, reason: "no-text", escalate: true };
  }
  if (length < minChars) {
    return { ok: false, reason: `thin-content(${length})`, escalate: true };
  }

  return { ok: true };
}
