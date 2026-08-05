/* Data-quality smoke test: URL canonicalization, HTML cleanup, content-type
   gating, and the post-parse quality gate. No network, no API key. */
import assert from "node:assert";
import { canonicalKey, normalizeUrl } from "../src/lib/urls.js";
import { rewriteUrl } from "../src/lib/rewriteUrl.js";
import { cleanHtml } from "../src/pipeline/cleanHtml.js";
import { extractTables } from "../src/extract/tables.js";
import { runPipeline } from "../src/pipeline/index.js";
import {
  detectUnsupportedContent,
  evaluateDocument,
} from "../src/engines/resilience.js";
import { scrapeUrl, UnsupportedContentError } from "../src/core/scrape.js";
import { engines } from "../src/engines/registry.js";
import type { Document, RawResult, ScrapeOptions } from "../src/types.js";
import type { FetchEngine } from "../src/core/ports.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));

const ctx = { url: "https://news.test/a", options: {}, log: () => {} };

function testCanonicalKey() {
  console.log("canonical-key:");

  const variants = [
    "http://www.news.test/a/index.html?utm_source=fb&utm_medium=social",
    "https://news.test/a/",
    "https://news.test:443/a",
    "https://www.news.test/a?fbclid=xyz",
    "https://news.test/a#section",
  ];
  const keys = new Set(variants.map((v) => canonicalKey(v)));
  assert.equal(keys.size, 1, `expected 1 key, got ${[...keys].join(", ")}`);
  assert.equal([...keys][0], "https://news.test/a");
  ok("www/http/port/index.html/trailing-slash/utm/fragment all collapse to one key");

  // Pagination and real query params must survive — they identify documents.
  assert.notEqual(
    canonicalKey("https://news.test/a?page=2"),
    canonicalKey("https://news.test/a?page=3"),
  );
  ok("real query params (?page=) still distinguish documents");

  // Param order is not identity.
  assert.equal(
    canonicalKey("https://news.test/a?b=2&a=1"),
    canonicalKey("https://news.test/a?a=1&b=2"),
  );
  ok("query param order does not create a duplicate");

  // SPA hash routes DO identify a document.
  assert.notEqual(
    canonicalKey("https://app.test/#/users"),
    canonicalKey("https://app.test/#/orders"),
  );
  ok("client-router hashes (#/route) are kept as distinct documents");

  assert.equal(canonicalKey("mailto:x@y.z"), null);
  ok("non-http schemes rejected");

  // normalizeUrl stays fetchable — it must NOT force https or drop www.
  assert.equal(
    normalizeUrl("http://www.news.test/a"),
    "http://www.news.test/a",
  );
  ok("normalizeUrl left untouched (still a fetchable URL)");
}

function testRewriteUrl() {
  console.log("url-rewrite:");
  assert.equal(
    rewriteUrl("https://docs.google.com/document/d/ABC-123/edit"),
    "https://docs.google.com/document/d/ABC-123/export?format=html",
  );
  ok("google doc -> html export");

  assert.equal(
    rewriteUrl("https://docs.google.com/spreadsheets/d/XYZ/edit#gid=42"),
    "https://docs.google.com/spreadsheets/d/XYZ/gviz/tq?tqx=out:html&gid=42",
  );
  ok("sheet -> gviz html, preserving the selected tab");

  assert.equal(
    rewriteUrl("https://docs.google.com/document/d/e/PUBLISHED/pub"),
    undefined,
  );
  ok("already-published /d/e/ URLs are left alone");

  assert.equal(rewriteUrl("https://news.test/a"), undefined);
  ok("ordinary URLs are not rewritten");
}

const LAZY_PAGE = `<!doctype html><html><body>
  <nav class="navbar"><a href="/home">Home</a></nav>
  <main>
    <div class="share"><a href="/share">Share</a></div>
    <h1>Judul Berita</h1>
    <img src="/spacer.gif" data-src="/img/hero.jpg">
    <img srcset="/s/small.jpg 320w, /s/large.jpg 1200w" src="/s/fallback.jpg">
    <p>${"Isi artikel yang cukup panjang supaya lolos ambang batas teks. ".repeat(6)}</p>
    <a href="/berita/lain">Berita lain</a>
  </main>
  <footer class="footer">footer chrome</footer>
</body></html>`;

function clean(html: string, options: ScrapeOptions = {}): Document {
  const doc: Document = {
    rawHtml: html,
    metadata: { url: "https://news.test/a" },
  };
  return cleanHtml.transform(doc, { ...ctx, options }) as Document;
}

function testCleanHtml() {
  console.log("clean-html:");

  const doc = clean(LAZY_PAGE, { onlyMainContent: true });
  const html = doc.html ?? "";

  assert.ok(
    html.includes("https://news.test/img/hero.jpg"),
    "lazy data-src not promoted",
  );
  ok("lazy-loaded data-src promoted to src and absolutized");

  assert.ok(
    html.includes("https://news.test/s/large.jpg"),
    "srcset largest candidate not chosen",
  );
  assert.ok(!html.includes("small.jpg"), "small srcset candidate survived");
  ok("srcset resolves to the largest candidate");

  assert.ok(
    html.includes('href="https://news.test/berita/lain"'),
    "relative link not absolutized",
  );
  ok("relative links rewritten to absolute");

  assert.ok(!html.includes("navbar"), "nav survived");
  assert.ok(!html.includes("Share"), "share widget inside <main> survived");
  ok("page chrome removed, including chrome nested inside <main>");

  assert.equal(doc.metadata.mainContent, true);
  assert.ok((doc.metadata.textLength as number) > 200);
  ok("records mainContent + textLength for the quality gate");

  // The force-include guard: a wrapper with a chrome-ish class that CONTAINS
  // the article must not take the article down with it.
  const trap = `<!doctype html><html><body><div class="widget"><main>
    <p>${"Konten asli di dalam pembungkus berkelas chrome. ".repeat(8)}</p>
  </main></div></body></html>`;
  const trapDoc = clean(trap, { onlyMainContent: true });
  assert.ok(
    (trapDoc.html ?? "").includes("Konten asli"),
    "force-include guard failed: article removed with its .widget wrapper",
  );
  ok("force-include guard spares chrome-classed wrappers that hold content");

  // Chrome removal that would empty the page must widen back out.
  const allChrome = `<!doctype html><html><body><div class="widget">
    <p>${"Situs ini melabeli kontennya sendiri sebagai widget. ".repeat(8)}</p>
  </div></body></html>`;
  const widened = clean(allChrome, { onlyMainContent: true });
  assert.ok(
    (widened.html ?? "").includes("melabeli kontennya"),
    "page emptied by chrome removal without falling back",
  );
  ok("widens back to raw when chrome removal would empty the page");

  // Regression guard: on statistics sites the payload IS the table, and those
  // tables routinely sit in .widget/.sidebar containers. Stripping chrome must
  // never take the dataset with it — extractTables() reads doc.html whenever
  // the caller asked for formats:["html"] and rawHtml was coerced away.
  const tablePage = `<!doctype html><html><body><div class="widget"><table>
    <tr><th>Provinsi</th><th>Inflasi</th></tr>
    <tr><td>Aceh</td><td>2,4</td></tr>
    <tr><td>Bali</td><td>1,9</td></tr>
  </table></div></body></html>`;
  const tableDoc = clean(tablePage, { onlyMainContent: true });
  const tables = extractTables({
    html: tableDoc.html,
    metadata: tableDoc.metadata,
  });
  assert.equal(tables.length, 1, "chrome removal ate a data table");
  assert.equal(tables[0].rows.length, 2);
  ok("data tables survive chrome removal (force-include guard covers <table>)");
}

async function testPipelineMarkdown() {
  console.log("pipeline:");
  const doc = await runPipeline(
    { rawHtml: LAZY_PAGE, metadata: { url: "https://news.test/a" } },
    { formats: ["markdown", "links"], onlyMainContent: true },
  );

  assert.ok(doc.markdown?.includes("# Judul Berita"));
  assert.ok(
    doc.markdown?.includes("https://news.test/img/hero.jpg"),
    "markdown lost the absolute image url",
  );
  assert.ok(
    !doc.markdown?.includes("](/"),
    "markdown still contains a root-relative link",
  );
  ok("markdown carries absolute image + link URLs only");

  assert.ok(!doc.markdown?.includes("footer chrome"));
  ok("chrome does not reach the markdown");
}

function testContentTypeGate() {
  console.log("content-type gate:");
  const pdf: RawResult = {
    rawHtml: "%PDF-1.7\n%âãÏÓ\nobj",
    contentType: "application/octet-stream",
    statusCode: 200,
  };
  assert.equal(detectUnsupportedContent(pdf), "application/pdf");
  ok("PDF detected by magic bytes despite an octet-stream label");

  assert.equal(
    detectUnsupportedContent({ rawHtml: "<html>x</html>", contentType: "image/png" }),
    "image/png",
  );
  ok("declared binary type rejected");

  assert.equal(
    detectUnsupportedContent({
      rawHtml: "<!doctype html><html><body>hi</body></html>",
      contentType: "text/html; charset=utf-8",
    }),
    null,
  );
  ok("ordinary HTML passes");
}

function testQualityGate() {
  console.log("quality gate:");
  assert.equal(
    evaluateDocument({ markdown: "x".repeat(500), metadata: { url: "u" } }).ok,
    true,
  );
  ok("substantial text accepted");

  const thin = evaluateDocument({ markdown: "Loading...", metadata: { url: "u" } });
  assert.equal(thin.ok, false);
  assert.equal(thin.escalate, true);
  ok("thin content rejected and marked for escalation");

  const wall = evaluateDocument({
    markdown: "Just a moment... " + "checking your browser ".repeat(20),
    metadata: { url: "u" },
  });
  assert.equal(wall.ok, false);
  assert.ok(wall.reason?.includes("cloudflare"));
  ok("anti-bot wall caught after parsing, not returned as content");

  // Body fields stripped by format coercion — textLength keeps it measurable.
  assert.equal(
    evaluateDocument({ metadata: { url: "u", textLength: 900 } }).ok,
    true,
    "quality gate misjudged a links-only scrape as empty",
  );
  ok("formats:['links'] scrape is not mistaken for an empty page");
}

/** Installs fake engines as the whole registry for one test. */
function withFakeEngines<T>(fakes: FetchEngine[], fn: () => Promise<T>): Promise<T> {
  const original = [...engines];
  engines.length = 0;
  engines.push(...fakes);
  return fn().finally(() => {
    engines.length = 0;
    engines.push(...original);
  });
}

const RICH = `<!doctype html><html><head><title>Berita</title></head><body><main>
  <p>${"Artikel yang panjang dan layak dijadikan hasil scraping. ".repeat(8)}</p>
</main></body></html>`;

/**
 * Builds a fake engine against the real port. `weak` engines declare no
 * javascript/stealth, which is what makes the re-planning path fire.
 */
function fakeEngine(
  name: string,
  fetchImpl: () => Promise<RawResult>,
  opts: { strong?: boolean; quality?: number } = {},
): FetchEngine {
  const strong = opts.strong ?? false;
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
    quality: opts.quality ?? (strong ? 50 : 100),
    maxReasonableTime: () => 5_000,
    fetch: fetchImpl,
  };
}

const rich = (): Promise<RawResult> =>
  Promise.resolve({ rawHtml: RICH, statusCode: 200, contentType: "text/html" });

async function testScrapeEscalation() {
  console.log("scrape escalation:");

  // 1. A blocked cheap engine re-plans onto the engine that can get through.
  const calls: string[] = [];
  const blocked = fakeEngine("cheap", async () => {
    calls.push("cheap");
    return { rawHtml: "<html><body>Just a moment...</body></html>", statusCode: 200 };
  });
  const strong = fakeEngine(
    "strong",
    async () => {
      calls.push("strong");
      return rich();
    },
    { strong: true },
  );
  const doc = await withFakeEngines([blocked, strong], () =>
    scrapeUrl("https://news.test/a", { formats: ["markdown"] }),
  );
  assert.deepEqual(calls, ["cheap", "strong"]);
  assert.equal(doc.metadata.engine, "strong");
  assert.equal(doc.metadata.degraded, undefined);
  ok("block on the cheap engine re-plans onto the stronger one");

  // 2. A 404 is final — escalating would only waste a browser launch.
  const calls2: string[] = [];
  const gone = fakeEngine("cheap", async () => {
    calls2.push("cheap");
    return { rawHtml: "<html>Not Found</html>", statusCode: 404 };
  });
  const never = fakeEngine(
    "strong",
    async () => {
      calls2.push("strong");
      return rich();
    },
    { strong: true },
  );
  await assert.rejects(
    withFakeEngines([gone, never], () => scrapeUrl("https://news.test/missing")),
    /All engines failed/,
  );
  assert.deepEqual(calls2, ["cheap"], "404 wrongly escalated to the browser");
  ok("404 stops the waterfall instead of escalating");

  // 3. Everything rejected, but one engine produced text -> return it, flagged.
  const thinA = fakeEngine(
    "a",
    async () => ({ rawHtml: "<html><body><p>halo</p></body></html>", statusCode: 200 }),
    { quality: 100 },
  );
  const thinB = fakeEngine(
    "b",
    async () => ({
      rawHtml: "<html><body><p>halo dunia sedikit lebih panjang</p></body></html>",
      statusCode: 200,
    }),
    { quality: 90 },
  );
  const degraded = await withFakeEngines([thinA, thinB], () =>
    scrapeUrl("https://news.test/thin", { formats: ["markdown"] }),
  );
  assert.equal(degraded.metadata.engine, "b", "did not pick the richer partial");
  assert.ok(degraded.metadata.degraded?.startsWith("thin-content"));
  ok("returns the best partial result flagged as degraded, not an exception");

  // 4. A PDF body is fatal and never escalates.
  const calls4: string[] = [];
  const pdfEngine = fakeEngine("cheap", async () => {
    calls4.push("cheap");
    return { rawHtml: "%PDF-1.7 binary junk", statusCode: 200 };
  });
  const never4 = fakeEngine(
    "strong",
    async () => {
      calls4.push("strong");
      return rich();
    },
    { strong: true },
  );
  await assert.rejects(
    withFakeEngines([pdfEngine, never4], () => scrapeUrl("https://news.test/doc.pdf")),
    (e: unknown) => e instanceof UnsupportedContentError,
  );
  assert.deepEqual(calls4, ["cheap"]);
  ok("binary body fails fast with UnsupportedContentError");
}

async function testMetadata() {
  console.log("metadata:");
  const html = `<!doctype html><html lang="id"><head>
    <title>Judul</title>
    <link rel="canonical" href="/artikel/1">
    <link rel="icon" href="/fav.ico">
    <meta property="og:image" content="/og.jpg">
    <meta property="og:site_name" content="News Test">
    <meta name="author" content="Budi Santoso">
    <meta property="article:published_time" content="2026-06-16T09:00:00+07:00">
  </head><body><main><p>${"teks panjang. ".repeat(30)}</p></main></body></html>`;

  const doc = await runPipeline(
    { rawHtml: html, metadata: { url: "https://news.test/a" } },
    { formats: ["markdown"] },
  );
  assert.equal(doc.metadata.canonical, "https://news.test/artikel/1");
  assert.equal(doc.metadata.ogImage, "https://news.test/og.jpg");
  assert.equal(doc.metadata.favicon, "https://news.test/fav.ico");
  assert.equal(doc.metadata.siteName, "News Test");
  assert.equal(doc.metadata.author, "Budi Santoso");
  assert.equal(doc.metadata.publishedDate, "2026-06-16");
  ok("canonical/og:image/favicon absolutized; author + date resolved");

  // A social-profile URL is not an author name.
  const bad = await runPipeline(
    {
      rawHtml: `<html><head><meta name="author" content="https://twitter.com/x"></head>
        <body><p>${"teks. ".repeat(60)}</p></body></html>`,
      metadata: { url: "https://news.test/b" },
    },
    { formats: ["markdown"] },
  );
  assert.equal(bad.metadata.author, undefined);
  ok("social-URL 'authors' rejected rather than recorded as a name");
}

async function main() {
  testCanonicalKey();
  testRewriteUrl();
  testCleanHtml();
  await testPipelineMarkdown();
  testContentTypeGate();
  testQualityGate();
  await testScrapeEscalation();
  await testMetadata();
  console.log(`\nAll ${passed} data-quality checks passed ✅`);
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e);
  process.exit(1);
});
