/* Live camoufox verification: auto-install/update, a real fetch, an explicit
   engine choice, and a fingerprint check that a plain browser would fail. */
import { ensureCamoufox } from "../src/engines/camoufox.js";
import { scrapeUrl } from "../src/core/scrape.js";
import { shutdownEngines } from "../src/engines/registry.js";

let pass = 0;
let fail = 0;
const ok = (n: string, x = "") => (pass++, console.log(`  ✓ ${n}${x ? " — " + x : ""}`));
const bad = (n: string, e: unknown) => (fail++, console.log(`  ✗ ${n} — ${(e as Error)?.message ?? e}`));

async function step<T>(name: string, fn: () => Promise<T>, check: (r: T) => string) {
  process.stdout.write(`  … ${name}\n`);
  const t0 = Date.now();
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  try {
    ok(name, `${check(await fn())} [${secs()}]`);
  } catch (e) {
    bad(name, `${(e as Error)?.message ?? e} [${secs()}]`);
  }
}

async function main() {
  console.log("\n== auto-install / auto-update ==");
  await step(
    "ensureCamoufox()",
    () => ensureCamoufox((m) => console.log(`     ${m}`)),
    (s) => {
      if (s.action === "unavailable") throw new Error(`camoufox-js not loadable: ${s.error}`);
      if (!s.installed) throw new Error("no browser installed after ensure");
      return `action=${s.action} installed=${s.installed}${s.latest ? ` latest=${s.latest}` : ""}`;
    },
  );

  // Second call must be cheap: the throttle should stop it re-hitting GitHub.
  await step(
    "second ensureCamoufox() is throttled",
    () => ensureCamoufox(),
    (s) => {
      if (s.action === "updated" || s.action === "installed") {
        throw new Error(`re-downloaded on the second call (action=${s.action})`);
      }
      return `action=${s.action} (no repeat download)`;
    },
  );

  console.log("\n== real fetch through camoufox ==");
  await step(
    "explicit engine: 'camoufox'",
    () => scrapeUrl("https://example.com", { formats: ["markdown"], engine: "camoufox", timeoutMs: 90000 }),
    (d) => {
      if (d.metadata.engine !== "camoufox") throw new Error(`ran on ${d.metadata.engine}`);
      if (!d.markdown?.includes("Example Domain")) throw new Error("wrong content");
      return `engine=${d.metadata.engine}, ${d.markdown.length} chars`;
    },
  );

  await step(
    "explicit engine: 'playwright' still selectable",
    () => scrapeUrl("https://example.com", { formats: ["markdown"], engine: "playwright", timeoutMs: 60000 }),
    (d) => {
      if (d.metadata.engine !== "playwright") throw new Error(`ran on ${d.metadata.engine}`);
      return `engine=${d.metadata.engine}, ${d.markdown?.length ?? 0} chars`;
    },
  );

  await step(
    "JS-rendered page via camoufox",
    () =>
      scrapeUrl("https://quotes.toscrape.com/js/", {
        formats: ["markdown"],
        engine: "camoufox",
        timeoutMs: 90000,
      }),
    (d) => {
      if (!d.markdown || d.markdown.length < 200) throw new Error("no JS-rendered content");
      return `${d.markdown.length} chars of client-rendered content`;
    },
  );

  console.log("\n== does it present differently from plain automation? ==");
  // Asserting something checkable from HTML alone. A page that echoes request
  // headers proves what the browser actually sent; scraping a fingerprint
  // dashboard and pattern-matching its markup proves only that the markup
  // changed shape.
  // One page, read twice. It reports back both the User-Agent it received and
  // its own webdriver verdict, so every claim below is something the probe
  // actually stated — not markup we pattern-matched into meaning.
  const probe = async (engine: string) => {
    const d = await scrapeUrl("https://bot.sannysoft.com/", {
      formats: ["markdown"],
      engine,
      timeoutMs: 90000,
    });
    const md = d.markdown ?? "";
    if (md.length < 300) throw new Error(`probe page did not render under ${engine}`);
    const ua = (/User Agent[^|]*\|\s*([^|\n]+)/i.exec(md) ?? [])[1]?.trim() ?? "";
    const webdriver = (/WebDriver[^|]*\|\s*([^|\n]+)/i.exec(md) ?? [])[1]?.trim() ?? "";
    return { ua, webdriver, len: md.length };
  };

  await step(
    "camoufox presents as a real Firefox, distinct from plain automation",
    async () => ({ cf: await probe("camoufox"), pw: await probe("playwright") }),
    ({ cf, pw }) => {
      if (!cf.ua) throw new Error("no user-agent reported");
      if (/headless/i.test(cf.ua)) throw new Error(`UA admits headless: ${cf.ua}`);
      if (!/firefox/i.test(cf.ua)) throw new Error(`not a Firefox UA: ${cf.ua}`);
      if (cf.ua === pw.ua) throw new Error("identical to plain playwright");
      return `"${cf.ua.slice(0, 52)}…" (playwright reports Chrome)`;
    },
  );

  await step(
    "the probe page's own webdriver test passes under camoufox",
    () => probe("camoufox"),
    (r) => {
      if (!/missing|passed/i.test(r.webdriver)) {
        throw new Error(`webdriver verdict was "${r.webdriver}"`);
      }
      return `WebDriver -> "${r.webdriver}" across ${r.len} chars rendered`;
    },
  );

  await step(
    "capability routing reaches camoufox without naming it",
    () =>
      scrapeUrl("https://example.com", {
        formats: ["markdown"],
        features: ["stealth"],
        timeoutMs: 90000,
      }),
    (d) => {
      if (d.metadata.engine !== "camoufox") {
        throw new Error(`stealth request ran on ${d.metadata.engine}`);
      }
      return "features:['stealth'] routed to camoufox on its own";
    },
  );

  await shutdownEngines();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error("fatal:", e);
  await shutdownEngines();
  process.exit(1);
});
