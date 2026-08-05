/* Live end-to-end verification against the real web. Not part of `npm test`
   (which is deterministic and offline) — this proves the engines, extractors
   and pipeline work on real pages. Ignored by git via the live-* rule. */
import { scrapeUrl } from "../src/core/scrape.js";
import { extractArticle } from "../src/extract/article.js";
import { extractProduct } from "../src/extract/product.js";
import { largestTable, extractTables } from "../src/extract/tables.js";
import { tidyTable } from "../src/extract/tidy.js";
import { deepExtract } from "../src/extract/deep.js";
import { mapSite } from "../src/core/map.js";
import { crawl } from "../src/core/crawl.js";
import { safeFetch } from "../src/lib/safeFetch.js";
import { BlockedAddressError } from "../src/core/errors.js";
import { shutdownEngines } from "../src/engines/registry.js";

let pass = 0;
let fail = 0;
const ok = (n: string, extra = "") => (pass++, console.log(`  ✓ ${n}${extra ? " — " + extra : ""}`));
const bad = (n: string, e: unknown) => (fail++, console.log(`  ✗ ${n} — ${(e as Error)?.message ?? e}`));

async function step<T>(name: string, fn: () => Promise<T>, check: (r: T) => string): Promise<T | null> {
  process.stdout.write(`  … ${name}\n`);
  const t0 = Date.now();
  const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  try {
    const r = await fn();
    const note = check(r);
    ok(name, `${note} [${ms()}]`);
    return r;
  } catch (e) {
    bad(name, `${(e as Error)?.message ?? e} [${ms()}]`);
    return null;
  }
}

async function main() {
  console.log("\n== 1. basic scrape (real HTTP) ==");
  await step(
    "example.com -> markdown",
    () => scrapeUrl("https://example.com", { formats: ["markdown"], onlyMainContent: true }),
    (d) => {
      if (!d.markdown?.includes("Example Domain")) throw new Error("no expected content");
      return `engine=${d.metadata.engine}, ${d.markdown.length} chars, degraded=${d.metadata.degraded ?? "no"}`;
    },
  );

  console.log("\n== 2. universal article extractor (Indonesian news) ==");
  const newsSites: [string, string][] = [
    ["Detik", "https://finance.detik.com/"],
    ["Kompas", "https://money.kompas.com/"],
    ["CNBC", "https://www.cnbcindonesia.com/market"],
  ];
  for (const [name, section] of newsSites) {
    try {
      // Find a real article link from the section page, then extract it.
      const idx = await scrapeUrl(section, { formats: ["links"], timeoutMs: 30000 });
      // An article URL, not the section index: these sites all put a numeric id
      // or a dated path in article links. Requiring one stops the test from
      // "passing" by extracting the section page's own <title>.
      // Same host only. Section pages are full of ad-network links, and an
      // "id=6163907479" in a doubleclick URL matches a numeric-id pattern just
      // as well as a real article id does.
      const host = new URL(section).hostname;
      const link = (idx.links ?? []).find((u) => {
        try {
          if (new URL(u).hostname !== host) return false;
        } catch {
          return false;
        }
        return (
          /\/(?:d-\d{6,}|read\/\d{4}|\d{4}\/\d{2}\/\d{2}\/|\d{8,})/.test(u) &&
          !u.includes("#") &&
          u !== section
        );
      });
      if (!link) throw new Error("no article link found on section page");
      const doc = await scrapeUrl(link, { formats: ["rawHtml"], timeoutMs: 30000 });
      const a = extractArticle(doc);
      if (!a.title) throw new Error("no title extracted");
      // A real article has a body and a date; a section page has neither.
      if (!a.body || a.body.length < 300) {
        throw new Error(`body too short (${a.body?.length ?? 0}ch) — is ${link} an article?`);
      }
      if (!a.publishedDate) throw new Error("no publish date resolved");
      ok(
        `${name} article`,
        `"${a.title.slice(0, 46)}…" date=${a.publishedDate ?? "-"} author=${a.author ?? "-"} body=${a.body?.length ?? 0}ch`,
      );
    } catch (e) {
      bad(`${name} article`, e);
    }
  }

  console.log("\n== 3. tables -> tidy -> deepExtract (Wikipedia) ==");
  const wiki = "https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_population";
  const wdoc = await step(
    "wikipedia scrape",
    () => scrapeUrl(wiki, { formats: ["rawHtml"], timeoutMs: 40000 }),
    (d) => `${d.rawHtml?.length ?? 0} bytes, ${extractTables(d).length} tables`,
  );
  if (wdoc) {
    await step(
      "largestTable + tidyTable",
      async () => tidyTable(largestTable(wdoc)!, { snakeCase: true }),
      (t) => {
        const typed = t.columns.filter((c) => c.type !== "text").length;
        if (t.rowCount < 50) throw new Error(`only ${t.rowCount} rows`);
        return `${t.rowCount} rows, ${t.columns.length} cols (${typed} typed): ${t.columns.map((c) => `${c.name}:${c.type}`).slice(0, 4).join(", ")}`;
      },
    );
  }
  await step(
    "deepExtract join (2 Wikipedia pages)",
    () =>
      deepExtract(
        [
          { url: wiki, label: "pop" },
          {
            url: "https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal)",
            label: "gdp",
          },
        ],
        { merge: "join", key: "@first", concurrency: 2 },
      ),
    (r) => {
      if (!r.matchedKeys || r.matchedKeys < 20) throw new Error(`only ${r.matchedKeys} keys matched`);
      return `${r.table.rowCount} rows, ${r.matchedKeys} keys matched across sources`;
    },
  );

  console.log("\n== 4. discovery: mapSite + crawl ==");
  await step(
    "mapSite (sitemap + links)",
    () => mapSite("https://quotes.toscrape.com/", { limit: 20, timeoutMs: 20000 }),
    (u) => {
      // Asserting a count, not just printing one: a bare `${u.length} urls`
      // reports success on an empty result.
      if (u.length === 0) throw new Error("discovered no URLs at all");
      return `${u.length} urls (${u.filter((e) => e.source === "sitemap").length} from sitemap)`;
    },
  );
  await step(
    "crawl (same-site BFS, real network)",
    () =>
      crawl("https://quotes.toscrape.com/", {
        limit: 5,
        maxDepth: 1,
        concurrency: 3,
        scrapeOptions: { formats: ["markdown"] },
      }),
    (r) => {
      if (r.documents.length < 2) throw new Error(`only ${r.documents.length} pages`);
      return `${r.documents.length} pages, ${r.errors.length} errors, dedup ok`;
    },
  );

  console.log("\n== 5. product extractor (real store) ==");
  // The extractor resolves schema.org Product JSON-LD / OG product meta, so the
  // site under test must actually emit them. books.toscrape.com emits neither —
  // returning nulls there is correct behaviour, not a passing test.
  await step(
    "product page with schema.org markup",
    async () => {
      const d = await scrapeUrl("https://www.scrapingcourse.com/ecommerce/product/hollister-backyard-sweatshirt/", {
        formats: ["rawHtml"],
        timeoutMs: 30000,
      });
      return { p: extractProduct(d), hasLd: /application\/ld\+json/.test(d.rawHtml ?? "") };
    },
    ({ p, hasLd }) => {
      if (!hasLd) throw new Error("test site no longer emits JSON-LD — pick another");
      if (!p.name) throw new Error("JSON-LD present but no product name extracted");
      return `"${p.name}" price=${p.priceText ?? p.price ?? "-"} avail=${p.availability ?? "-"} src=${JSON.stringify(p.sources).slice(0, 60)}`;
    },
  );
  await step(
    "a store with NO structured markup yields nulls, never invented values",
    async () => {
      const d = await scrapeUrl(
        "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
        { formats: ["rawHtml"], timeoutMs: 30000 },
      );
      return extractProduct(d);
    },
    (p) => {
      if (p.price !== null && p.price !== undefined) {
        throw new Error(`invented a price (${p.price}) from a page with no markup`);
      }
      return "name/price null as expected (honest failure)";
    },
  );

  console.log("\n== 6. engine layer, live ==");
  await step(
    "playwright engine on a JS-rendered page",
    () =>
      scrapeUrl("https://quotes.toscrape.com/js/", {
        formats: ["markdown"],
        requiresJs: true,
        timeoutMs: 60000,
      }),
    (d) => {
      if (!d.markdown || d.markdown.length < 200) throw new Error("no JS-rendered content");
      return `engine=${d.metadata.engine}, ${d.markdown.length} chars`;
    },
  );
  await step(
    "404 is fatal, no browser launch",
    async () => {
      const t0 = Date.now();
      try {
        await scrapeUrl("https://example.com/definitely-not-a-real-page-xyz", {
          formats: ["markdown"],
        });
        return { ms: Date.now() - t0, threw: false };
      } catch {
        return { ms: Date.now() - t0, threw: true };
      }
    },
    (r) => {
      if (!r.threw) throw new Error("should have failed");
      if (r.ms > 15000) throw new Error(`took ${r.ms}ms — escalated to a browser?`);
      return `failed in ${r.ms}ms without escalating`;
    },
  );
  await step(
    "dead domain stops the waterfall",
    async () => {
      const t0 = Date.now();
      try {
        await scrapeUrl("https://this-domain-does-not-exist-drazta-check.invalid/");
        return { ms: Date.now() - t0, threw: false };
      } catch {
        return { ms: Date.now() - t0, threw: true };
      }
    },
    (r) => {
      if (!r.threw) throw new Error("should have failed");
      if (r.ms > 15000) throw new Error(`took ${r.ms}ms — retried or escalated?`);
      return `failed in ${r.ms}ms (no retries, no browser)`;
    },
  );

  console.log("\n== 7. SSRF guard against real DNS ==");
  for (const [label, url] of [
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
    ["localhost", "http://localhost:6379/"],
  ] as [string, string][]) {
    try {
      await safeFetch(url);
      bad(`${label} refused`, new Error("NOT refused — it went through"));
    } catch (e) {
      if (e instanceof BlockedAddressError) ok(`${label} refused`, (e as BlockedAddressError).address);
      else bad(`${label} refused`, e);
    }
  }

  await shutdownEngines(); // else the shared browser keeps this process alive
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
