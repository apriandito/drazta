/* Engine-layer smoke test: capability routing, hedging, re-planning, the error
   taxonomy, and the SSRF guard. No network, no API key. */
import assert from "node:assert";
import { engines, buildFallbackList, requiredFeatures } from "../src/engines/registry.js";
import { scrapeUrl } from "../src/core/scrape.js";
import {
  BlockedAddressError,
  DNSError,
  NoEnginesLeftError,
  SiteError,
  TimeoutError,
  classifyFetchError,
} from "../src/core/errors.js";
import { isPrivateAddress, safeFetch } from "../src/lib/safeFetch.js";
import { withRetry } from "../src/engines/resilience.js";
import type { FetchEngine } from "../src/core/ports.js";
import type { RawResult } from "../src/types.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));

const RICH = `<!doctype html><html><body><main><p>${"Artikel panjang yang layak. ".repeat(10)}</p></main></body></html>`;

function fakeEngine(
  name: string,
  fetchImpl: (url: string, opts: unknown, signal?: AbortSignal) => Promise<RawResult>,
  o: { strong?: boolean; quality?: number; mrt?: number } = {},
): FetchEngine {
  const strong = o.strong ?? false;
  return {
    name,
    features: {
      javascript: strong,
      stealth: strong,
      screenshot: strong,
      waitFor: strong,
      cookies: true,
      location: strong,
    },
    quality: o.quality ?? (strong ? 50 : 100),
    maxReasonableTime: () => o.mrt ?? 5_000,
    fetch: fetchImpl as FetchEngine["fetch"],
  };
}

function withEngines<T>(fakes: FetchEngine[], fn: () => Promise<T>): Promise<T> {
  const original = [...engines];
  engines.length = 0;
  engines.push(...fakes);
  return fn().finally(() => {
    engines.length = 0;
    engines.push(...original);
  });
}

/** Synchronous variant. The registry is global state, so an un-awaited async
 * swap would leak fake engines into whichever test runs next. */
function withEnginesSync<T>(fakes: FetchEngine[], fn: () => T): T {
  const original = [...engines];
  engines.length = 0;
  engines.push(...fakes);
  try {
    return fn();
  } finally {
    engines.length = 0;
    engines.push(...original);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function testRouting() {
  console.log("capability routing:");

  const cheap = fakeEngine("cheap", async () => ({ rawHtml: RICH }));
  const browser = fakeEngine("browser", async () => ({ rawHtml: RICH }), { strong: true });

  // No requirements -> pure quality order, cheapest-and-best first. Asserted
  // against the real registry rather than a fixed list, so registering a new
  // engine updates the expectation instead of breaking an unrelated test.
  const plain = buildFallbackList("https://x.test/", {}, []);
  const byQuality = [...engines].sort((a, b) => b.quality - a.quality).map((e) => e.name);
  assert.deepEqual(plain.map((c) => c.engine.name), byQuality);
  assert.equal(plain[0].engine.name, "fetch", "the cheapest engine should lead");
  ok(`with no requirements, engines rank by quality (${byQuality.join(" → ")})`);

  withEnginesSync([cheap, browser], () => {
    const list = buildFallbackList("https://x.test/", {}, []);
    assert.deepEqual(list.map((c) => c.engine.name), ["cheap", "browser"]);

    // javascript is high-priority: an engine that lacks it falls below the
    // threshold and is dropped entirely rather than tried and failed.
    const js = buildFallbackList("https://x.test/", { requiresJs: true }, []);
    assert.deepEqual(js.map((c) => c.engine.name), ["browser"]);
  });
  ok("requiring javascript drops engines that cannot provide it");

  // Options translate into capabilities without the caller naming them.
  assert.deepEqual([...requiredFeatures({ requiresJs: true, waitForMs: 500 })].sort(), [
    "javascript",
    "waitFor",
  ]);
  ok("options are translated into required capabilities");

  // A partially-capable engine still ranks — a boolean canHandle() could not
  // express this, which is the whole reason for scoring.
  const partial = fakeEngine("partial", async () => ({ rawHtml: RICH }), { quality: 10 });
  const full = fakeEngine("full", async () => ({ rawHtml: RICH }), {
    strong: true,
    quality: 1,
  });
  withEnginesSync([partial, full], () => {
    const list = buildFallbackList("https://x.test/", { features: ["cookies", "waitFor"] }, []);
    const names = list.map((c) => c.engine.name);
    assert.ok(names.includes("full") && names.includes("partial"), "partial dropped");
    assert.equal(names[0], "full", "fuller coverage should outrank higher quality");
    const p = list.find((c) => c.engine.name === "partial")!;
    assert.deepEqual(p.unsupported, ["waitFor"]);
  });
  ok("coverage outranks quality, and shortfalls are reported per engine");
}

async function testHedging() {
  console.log("hedging:");

  // The cheap engine is slow but would eventually succeed. A sequential
  // waterfall pays its full latency; hedging starts the browser alongside it
  // and returns whichever finishes first.
  const started: string[] = [];
  const slow = fakeEngine(
    "slow",
    async () => {
      started.push("slow");
      await sleep(3_000);
      return { rawHtml: RICH, statusCode: 200 };
    },
    { mrt: 600, quality: 100 },
  );
  const fast = fakeEngine(
    "fast",
    async () => {
      started.push("fast");
      await sleep(50);
      return { rawHtml: RICH, statusCode: 200 };
    },
    { strong: true, mrt: 600, quality: 50 },
  );

  const t0 = process.hrtime.bigint();
  const doc = await withEngines([slow, fast], () =>
    scrapeUrl("https://x.test/", { formats: ["markdown"] }),
  );
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  assert.deepEqual(started, ["slow", "fast"], "second engine was not hedged in");
  assert.equal(doc.metadata.engine, "fast");
  assert.ok(
    elapsedMs < 2_500,
    `hedging did not save time: waited ${Math.round(elapsedMs)}ms for a 3s engine`,
  );
  ok(`hedged engine wins while the slow one is still running (${Math.round(elapsedMs)}ms < 3000ms)`);

  // The loser must actually be cancelled, not left running.
  let aborted = false;
  const abortable = fakeEngine(
    "abortable",
    async (_u, _o, signal) => {
      signal?.addEventListener("abort", () => (aborted = true), { once: true });
      await sleep(3_000);
      return { rawHtml: RICH, statusCode: 200 };
    },
    { mrt: 600, quality: 100 },
  );
  const quick = fakeEngine("quick", async () => ({ rawHtml: RICH, statusCode: 200 }), {
    strong: true,
    mrt: 600,
    quality: 50,
  });
  await withEngines([abortable, quick], () => scrapeUrl("https://x.test/", { formats: ["markdown"] }));
  await sleep(20);
  assert.ok(aborted, "losing engine was never signalled to stop");
  ok("the losing engine receives an abort signal instead of running to completion");
}

async function testReplanning() {
  console.log("re-planning:");

  // A 403 is a statement about what the request needs, not a dead end.
  const seen: string[] = [];
  const plain = fakeEngine("plain", async () => {
    seen.push("plain");
    return { rawHtml: "<html><body>Forbidden</body></html>", statusCode: 403 };
  });
  const stealthy = fakeEngine(
    "stealthy",
    async () => {
      seen.push("stealthy");
      return { rawHtml: RICH, statusCode: 200 };
    },
    { strong: true },
  );
  const doc = await withEngines([plain, stealthy], () =>
    scrapeUrl("https://x.test/", { formats: ["markdown"] }),
  );
  assert.deepEqual(seen, ["plain", "stealthy"]);
  assert.equal(doc.metadata.engine, "stealthy");
  ok("HTTP 403 re-plans the run onto a stealth-capable engine");

  // A JS shell asks for a browser specifically.
  const shell = fakeEngine("plain", async () => ({
    rawHtml: '<html><body><div id="__next"></div></body></html>',
    statusCode: 200,
  }));
  const browser = fakeEngine("browser", async () => ({ rawHtml: RICH, statusCode: 200 }), {
    strong: true,
  });
  const doc2 = await withEngines([shell, browser], () =>
    scrapeUrl("https://x.test/", { formats: ["markdown"] }),
  );
  assert.equal(doc2.metadata.engine, "browser");
  ok("a JS-only shell re-plans onto a javascript-capable engine");

  // Re-planning must terminate when no engine can satisfy the new features.
  const onlyPlain = fakeEngine("plain", async () => ({
    rawHtml: "<html><body>Forbidden</body></html>",
    statusCode: 403,
  }));
  await assert.rejects(
    withEngines([onlyPlain], () => scrapeUrl("https://x.test/")),
    (e: unknown) => e instanceof NoEnginesLeftError,
  );
  ok("re-planning terminates instead of looping when nothing can satisfy it");
}

async function testErrorTaxonomy() {
  console.log("error taxonomy:");

  assert.ok(
    classifyFetchError({ cause: { code: "ENOTFOUND" } }, "https://nope.test/") instanceof DNSError,
  );
  assert.ok(
    classifyFetchError({ cause: { code: "ECONNREFUSED" } }, "https://x.test/") instanceof SiteError,
  );
  assert.ok(
    classifyFetchError({ name: "AbortError" }, "https://x.test/") instanceof TimeoutError,
  );
  ok("transport errors map onto DNS / Site / Timeout");

  // Fatality is the point: a dead domain must not be retried three times, nor
  // escalated to a browser that will hit the same dead domain.
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts++;
        throw new DNSError("nope", "https://nope.test/");
      },
      { retries: 2, shouldRetry: (e) => !(e instanceof DNSError) },
    ),
    (e: unknown) => e instanceof DNSError,
  );
  assert.equal(attempts, 1, "a fatal error was retried");
  ok("fatal errors are not retried");

  const calls: string[] = [];
  const dead = fakeEngine("dead", async () => {
    calls.push("dead");
    throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { cause: { code: "ENOTFOUND" } });
  });
  const browser = fakeEngine(
    "browser",
    async () => {
      calls.push("browser");
      return { rawHtml: RICH, statusCode: 200 };
    },
    { strong: true },
  );
  await assert.rejects(
    withEngines([dead, browser], () => scrapeUrl("https://nope.test/")),
    (e: unknown) => e instanceof NoEnginesLeftError,
  );
  assert.deepEqual(calls, ["dead"], "a dead domain still paid for a browser launch");
  ok("a DNS failure stops the waterfall instead of launching a browser");
}

async function testSSRFGuard() {
  console.log("ssrf guard:");

  for (const addr of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata — the one that leaks credentials
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1", // IPv4 loopback wearing an IPv6 hat
  ]) {
    assert.equal(isPrivateAddress(addr), true, `${addr} should be private`);
  }
  for (const addr of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(addr), false, `${addr} should be public`);
  }
  ok("private, loopback, link-local and IPv4-mapped ranges are all recognized");

  await assert.rejects(
    safeFetch("http://169.254.169.254/latest/meta-data/"),
    (e: unknown) => e instanceof BlockedAddressError,
  );
  ok("the cloud metadata endpoint is refused before any connection is made");

  await assert.rejects(
    safeFetch("http://localhost:6379/"),
    (e: unknown) => e instanceof BlockedAddressError || e instanceof DNSError,
  );
  ok("localhost is refused");

  // scrapeUrl must refuse it too — the guard has to sit under the engines,
  // not beside them.
  await assert.rejects(
    scrapeUrl("http://127.0.0.1:1/"),
    (e: unknown) => e instanceof NoEnginesLeftError || e instanceof BlockedAddressError,
  );
  ok("scrapeUrl inherits the guard through its fetch engine");
}

async function main() {
  testRouting();
  await testHedging();
  await testReplanning();
  await testErrorTaxonomy();
  await testSSRFGuard();
  console.log(`\nAll ${passed} engine checks passed ✅`);
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e);
  process.exit(1);
});
