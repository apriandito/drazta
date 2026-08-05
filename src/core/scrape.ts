import type { Document, ScrapeOptions } from "../types.js";
import type { FeatureFlag } from "./ports.js";
import { buildFallbackList, type EngineChoice } from "../engines/registry.js";
import { runPipeline } from "../pipeline/index.js";
import {
  detectUnsupportedContent,
  evaluateDocument,
  evaluateResult,
  withRetry,
} from "../engines/resilience.js";
import { rewriteUrl } from "../lib/rewriteUrl.js";
import {
  AddFeatureError,
  PageRejectedError,
  NoEnginesLeftError,
  ScrapeError,
  UnsupportedContentError,
  classifyFetchError,
} from "./errors.js";

export {
  NoEnginesLeftError,
  UnsupportedContentError,
  AddFeatureError,
} from "./errors.js";

/** Extra head start given to an in-flight engine before hedging the next one. */
const WATERFALL_DELAY_MS = 1_500;
/** Hard ceiling on re-planning rounds, so a mislabelling site can't loop. */
const MAX_REPLANS = 3;

interface Candidate {
  doc: Document;
  engine: string;
  reason: string;
  score: number;
}

function textScore(doc: Document): number {
  const text = (
    doc.markdown ?? (doc.html ?? doc.rawHtml ?? "").replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 0) return text.length;
  return typeof doc.metadata.textLength === "number" ? doc.metadata.textLength : 0;
}

/**
 * Runs one engine end-to-end and returns a document only if it survives
 * inspection. Everything that can be learned about *why* a page failed is
 * turned into either a re-plan request or an escalation signal here.
 */
async function runEngine(
  choice: EngineChoice,
  url: string,
  fetchUrl: string,
  rewritten: string | undefined,
  opts: ScrapeOptions,
  signal: AbortSignal,
  log: (msg: string, meta?: unknown) => void,
): Promise<{ doc: Document; verdictReason?: string; escalate?: boolean }> {
  const { engine } = choice;

  const raw = await withRetry(
    (attempt) => {
      signal.throwIfAborted();
      if (attempt > 0) log(`  ${engine.name} retry #${attempt}`);
      return engine.fetch(fetchUrl, opts, signal).catch((e) => {
        throw classifyFetchError(e, fetchUrl);
      });
    },
    {
      retries: opts.engine ? 3 : 2,
      onRetry: (e) => log(`  ${engine.name} threw: ${(e as Error)?.message}`),
      // A fatal error (dead DNS, refused connection, blocked address) will not
      // become true on the third try.
      shouldRetry: (e) => !(e instanceof ScrapeError && e.fatal),
    },
  );

  // Refuse binary before any parser touches it: a cheerio pass over a PDF
  // produces confident nonsense, which is worse than an honest failure.
  const unsupported = detectUnsupportedContent(raw);
  if (unsupported) throw new UnsupportedContentError(url, unsupported);

  const verdict = evaluateResult(raw);
  if (!verdict.ok) {
    // This is where detection becomes action. A 401/403/429 or an anti-bot
    // wall is not "try the next engine and hope" — it is a specific statement
    // about what the request needs, so we re-plan around that need.
    const wantsStealth =
      raw.statusCode !== undefined && [401, 403, 429].includes(raw.statusCode);
    if (wantsStealth && !engine.features.stealth) {
      throw new AddFeatureError(["stealth"], `HTTP ${raw.statusCode} from ${engine.name}`);
    }
    if (verdict.reason === "js-shell" && !engine.features.javascript) {
      throw new AddFeatureError(["javascript"], `${engine.name} received a JS-only shell`);
    }
    if (verdict.escalate && !engine.features.stealth) {
      throw new AddFeatureError(
        ["stealth", "javascript"],
        `${engine.name} hit ${verdict.reason}`,
      );
    }
    // Not escalatable (404, gone): no engine will do better, so mark it fatal
    // and let the waterfall stop instead of paying for a browser launch.
    throw new PageRejectedError(
      `${engine.name} rejected the page: ${verdict.reason}`,
      url,
      verdict.reason ?? "unusable",
      !verdict.escalate,
    );
  }

  const doc: Document = {
    rawHtml: raw.rawHtml,
    metadata: {
      url: raw.resolvedUrl ?? fetchUrl,
      sourceURL: url,
      statusCode: raw.statusCode,
      contentType: raw.contentType,
      engine: engine.name,
      ...(rewritten ? { rewrittenUrl: rewritten } : {}),
    },
  };
  const parsed = await runPipeline(doc, opts, log);

  // The real quality gate: judge the text actually extracted, not byte counts.
  const docVerdict = evaluateDocument(parsed);
  return {
    doc: parsed,
    verdictReason: docVerdict.ok ? undefined : (docVerdict.reason ?? "low-quality"),
    escalate: docVerdict.escalate,
  };
}

/**
 * One pass over a fallback list, hedged.
 *
 * A strictly sequential waterfall pays the full cost of every failure before
 * it learns anything: a slow-but-doomed HTTP fetch holds the whole request
 * hostage while the browser that would have succeeded sits idle. So instead of
 * waiting for engine N to fail, we start engine N+1 once N has had its
 * "maximum reasonable time", and let them race. First good document wins; the
 * losers are aborted.
 *
 * Cost is one extra in-flight request on slow pages; the benefit is that p95
 * latency stops being the sum of every engine's failure timeout.
 */
async function hedgedPass(
  list: EngineChoice[],
  url: string,
  fetchUrl: string,
  rewritten: string | undefined,
  opts: ScrapeOptions,
  log: (msg: string, meta?: unknown) => void,
): Promise<{
  doc?: Document;
  best: Candidate | null;
  attempts: { engine: string; error: string }[];
  /** A re-plan request is RETURNED, not thrown, so any partial content this
   * pass produced survives into the next round instead of being discarded. */
  replan?: AddFeatureError;
}> {
  const attempts: { engine: string; error: string }[] = [];
  const remaining = [...list];
  const controller = new AbortController();
  let best: Candidate | null = null;

  type Settled =
    | { kind: "ok"; doc: Document }
    | { kind: "fail"; engine: string; error: unknown }
    | { kind: "poor"; engine: string; doc: Document; reason: string; escalate?: boolean };

  const inFlight = new Map<string, Promise<Settled>>();

  const launch = (choice: EngineChoice): void => {
    const name = choice.engine.name;
    log(`trying engine: ${name}`, {
      supportScore: choice.supportScore,
      unsupported: choice.unsupported,
    });
    inFlight.set(
      name,
      runEngine(choice, url, fetchUrl, rewritten, opts, controller.signal, log)
        .then((r): Settled =>
          r.verdictReason
            ? { kind: "poor", engine: name, doc: r.doc, reason: r.verdictReason, escalate: r.escalate }
            : { kind: "ok", doc: r.doc },
        )
        .catch((error): Settled => ({ kind: "fail", engine: name, error })),
    );
  };

  try {
    launch(remaining.shift()!);

    while (inFlight.size > 0) {
      const hedgeAfter = remaining.length > 0 ? nextHedgeDelay(remaining[0], opts) : null;

      let timer: NodeJS.Timeout | undefined;
      const racers: Promise<Settled | { kind: "hedge" }>[] = [...inFlight.values()];
      if (hedgeAfter !== null) {
        racers.push(
          new Promise<{ kind: "hedge" }>((resolve) => {
            timer = setTimeout(() => resolve({ kind: "hedge" }), hedgeAfter);
          }),
        );
      }

      const outcome = await Promise.race(racers);
      if (timer) clearTimeout(timer);

      if (outcome.kind === "hedge") {
        // Nobody finished in time — start the next engine alongside, do not
        // cancel the one still running. It may still win.
        launch(remaining.shift()!);
        continue;
      }

      if (outcome.kind === "ok") {
        controller.abort(); // stop the losers
        return { doc: outcome.doc, best, attempts };
      }

      inFlight.delete(outcome.engine);

      if (outcome.kind === "poor") {
        attempts.push({ engine: outcome.engine, error: outcome.reason });
        log(`  ${outcome.engine} parsed but rejected: ${outcome.reason}`);
        const score = textScore(outcome.doc);
        if (!best || score > best.score) {
          best = { doc: outcome.doc, engine: outcome.engine, reason: outcome.reason, score };
        }
        if (outcome.escalate === false) break;
      } else {
        const err = outcome.error;
        // A re-plan request ends this pass but is not a failure.
        if (err instanceof AddFeatureError) return { best, attempts, replan: err };
        attempts.push({
          engine: outcome.engine,
          error: err instanceof Error ? err.message : String(err),
        });
        log(`  ${outcome.engine} failed: ${(err as Error)?.message}`);
        // Fatal means no engine can do better; stop burning launches on it.
        if (err instanceof ScrapeError && err.fatal) {
          if (err instanceof UnsupportedContentError) throw err;
          log(`  ${outcome.engine}: fatal (${err.name}); not escalating`);
          break;
        }
      }

      if (inFlight.size === 0 && remaining.length > 0) launch(remaining.shift()!);
    }
  } finally {
    controller.abort();
  }

  return { best, attempts };
}

function nextHedgeDelay(next: EngineChoice, opts: ScrapeOptions): number {
  // Hedge on the *running* engine's patience budget, floored so a fast engine
  // never causes an instant stampede of every engine at once.
  return Math.max(500, next.engine.maxReasonableTime(opts) / 4, WATERFALL_DELAY_MS);
}

/**
 * The primary use-case: a URL in, an inspected Document out.
 *
 * Three mechanisms decide the outcome, in order:
 *
 *  1. Capability routing — engines are ranked by how well they cover what this
 *     request actually needs, not by a fixed list.
 *  2. Hedging — the next engine starts once the current one has had its
 *     reasonable time, rather than after it finally fails.
 *  3. Re-planning — when an engine learns something that changes the routing
 *     (a 403 means stealth, a JS shell means a browser), the fallback list is
 *     rebuilt around that fact instead of blindly advancing one slot.
 *
 * If every engine is rejected but some produced partial content, the best of
 * them is returned with `metadata.degraded` set — real text beats an exception.
 */
export async function scrapeUrl(
  url: string,
  opts: ScrapeOptions = {},
  log: (msg: string, meta?: unknown) => void = () => {},
): Promise<Document> {
  new URL(url); // validate at the boundary

  // Some URLs are public but only ever serve an app shell to a scraper, while
  // a plain-HTML export of the same document sits next to them.
  const rewritten = rewriteUrl(url);
  const fetchUrl = rewritten ?? url;
  if (rewritten) log(`rewrote url -> ${rewritten}`);

  const extraFeatures = new Set<FeatureFlag>();
  const allAttempts: { engine: string; error: string }[] = [];
  let best: Candidate | null = null;

  for (let round = 0; round <= MAX_REPLANS; round++) {
    const list = buildFallbackList(fetchUrl, opts, extraFeatures);
    if (list.length === 0) {
      throw new NoEnginesLeftError(url, [
        ...allAttempts,
        { engine: "(none)", error: "no engine covers the required features" },
      ]);
    }

    const pass = await hedgedPass(list, url, fetchUrl, rewritten, opts, log);

    allAttempts.push(...pass.attempts);
    if (pass.best && (!best || pass.best.score > best.score)) best = pass.best;
    if (pass.doc) return pass.doc;

    if (!pass.replan) break;

    const added = pass.replan.features.filter(
      (f) => !extraFeatures.has(f as FeatureFlag),
    );
    if (added.length === 0) {
      // Nothing new to add — those features are already in play and still
      // failing, so this is exhaustion, not a reason to loop.
      allAttempts.push({
        engine: "(replan)",
        error: `${pass.replan.why} (no new features)`,
      });
      break;
    }
    added.forEach((f) => extraFeatures.add(f as FeatureFlag));
    log(`re-planning: +[${added.join(", ")}] (${pass.replan.why})`);
    allAttempts.push({ engine: "(replan)", error: pass.replan.why });
  }

  // Every engine was rejected. If one still produced text, that text is more
  // useful than an exception — flagged, not disguised.
  if (best) {
    log(`all engines rejected; returning best partial from ${best.engine} (${best.score} chars)`);
    best.doc.metadata.degraded = best.reason;
    return best.doc;
  }

  throw new NoEnginesLeftError(url, allAttempts);
}
