# Drazta

A web-scraping and structured-extraction engine that tries to be honest about
what it got. It fetches a page with whichever strategy fits, parses it through
one deterministic pipeline, and refuses to hand you an anti-bot wall or a PDF's
binary while calling it content.

Built on **Ports & Adapters**, so it scales from "URL → clean markdown" to
"describe what you want → get an Excel" without rewrites.

> Original MIT-licensed, clean-room implementation. It reimplements
> well-known scraping mechanisms from scratch; no AGPL source was copied.

## Install

```bash
npm install
npx playwright install chromium   # optional — only for JS-heavy pages
# Camoufox (stealth) needs no install step: the engine downloads and keeps
# its browser up to date by itself on first use.
```

Requires **Node 22+**. The floor is set by jsdom, which the deterministic
extraction sandbox runs on; Drazta's own code needs `AbortSignal.any` and
`Headers.getSetCookie`, which arrive earlier. CI covers Node 22 and 24.

## Quick start

```ts
import { scrapeUrl } from "drazta";

const doc = await scrapeUrl("https://example.com", {
  formats: ["markdown"],
  onlyMainContent: true,
});
doc.markdown;              // clean markdown, absolute links and images
doc.metadata.publishedDate // "2026-08-04", from the page's own JSON-LD
doc.metadata.degraded      // set only if every engine rejected the page
```

```bash
npm run cli -- https://example.com --main
npm run serve   # then POST /scrape and /extract
npm run ui      # the web console on http://localhost:3000
```

## The console

`npm run ui` builds the library and starts a Nuxt app that drives every
use-case from a browser — scrape, article/product extraction, tables and
multi-page merge, map and crawl, and the agent. It calls Drazta as a **library**
through Nitro server routes, so there is no second process and no HTTP hop.

Its one organising idea is the library's own: **nothing appears without saying
where it came from.** Each field carries the layer that produced it, and colour
is reserved for exactly that claim — teal for what the page stated, an outline
for what was derived deterministically, violet for what a model inferred, amber
for `degraded`. Buttons and chrome stay achromatic, so any hue on screen means
something. Every result also carries a receipt: which engine won the race, the
status code, characters of text that survived parsing, and elapsed time.

The Scrape page leads with the **routing plan** — the real output of
`buildFallbackList` for the options you have set. Toggle *Needs a browser* and
the waterfall re-plans in front of you: `fetch` is struck out as lacking
`javascript`, and the browser engines move up with their coverage scores. After
a run, the engine that produced the document is marked. It is the plan, though,
not a trace: hedging means the engines below the winner may never have started.

```bash
npm run ui                        # build + dev server
OPENAI_API_KEY=sk-… npm run ui    # the Agent page needs a key; nothing else does
npm run ui:build                  # production build of the console
```

The console lives in [`ui/`](ui/) and is a workspace, so a plain `npm install`
at the root sets it up. It is dev tooling, not part of the published package —
`files` still ships `dist` only.

## Why this shape

Fetching is the only thing that varies per site — static HTTP or a real
browser. Parsing should be identical no matter who fetched. The design splits
hard along that line:

```
Entrypoints:  REST API · CLI · Jobs CLI · Agent loop · Web console
                    │  call the same use-cases
Use-cases:    scrapeUrl · crawl · mapSite · extractStructured · deepExtract · runAgent
                    │  depend only on PORTS (interfaces)
Adapters:  FetchEngine │ Transformer │ LLMProvider │ ExportSink │ AgentTool │ SandboxRunner
           fetch, playw.│ clean,md,…  │ openai,…    │ md,json,xlsx│ 4 tools   │ jsdom+vm
```

Adding an engine, an LLM, or an output format means writing **one adapter**.
The core never changes.

## The engine layer

Four mechanisms decide what you actually get back.

Three engines ship: `fetch` (plain HTTP), `playwright` (Chromium, for
JavaScript), and `camoufox` (a patched Firefox, for stealth). Pick one
explicitly with `{ engine: "camoufox" }`, or describe what you need and let
routing choose.

**Capability routing.** Engines declare a feature matrix (`javascript`,
`stealth`, `screenshot`, `waitFor`, `cookies`, `location`) and a quality
weight. A request is translated into the capabilities it needs; each engine
scores the sum of the priorities it satisfies, anything below half the total
demand is dropped, and survivors sort by coverage then quality.

A boolean `canHandle()` cannot express "covers three of four needs" — so
routing has to be rewritten every time an engine is added. Scoring makes a new
engine a single declaration.

**Hedged waterfall.** The next engine does not wait for the current one to
fail. Once an engine has had its `maxReasonableTime`, the next one starts
*alongside* it and they race; the first good document wins and the losers get
an abort signal. A slow-but-doomed HTTP fetch no longer holds the request
hostage while the browser that would have succeeded sits idle.

**Re-planning.** When an engine learns something that changes the routing, the
fallback list is rebuilt around that fact instead of blindly advancing one
slot. A `403` means *this needs stealth*; a JS-only shell means *this needs a
browser*. Capped at three rounds, and partial results carry across them.

**One budget for the whole call.** `timeoutMs` bounds the scrape end to end —
every engine, every retry, every re-plan draws from the same clock, and each
attempt gets what is *left* rather than a fresh allowance. The per-attempt
reading is the trap: with four attempts against a black-holing host, a "60s
timeout" silently becomes a four-minute hang with nothing bounding it. Default
120s. Measured: a request that used to take 242s now returns in 20s when asked
for 20s.

**An error taxonomy where every error answers one question: `fatal`.** Dead
DNS, refused connection and TLS failure stop the waterfall — no browser launch,
no three retries — while a wall or a thin page escalates. Collapsing failures
into one string is what makes a scraper pay for a browser on a domain that does
not exist.

```ts
// Describe the need — routing picks the engine.
await scrapeUrl(url, { requiresJs: true });        // → playwright
await scrapeUrl(url, { features: ["stealth"] });   // → camoufox

// Or name it. A pinned engine is never overridden.
await scrapeUrl(url, { engine: "camoufox" });
await scrapeUrl(url, { engine: "playwright" });
```

## Stealth: Camoufox

Playwright's Chromium hides `navigator.webdriver` and little else; a real
fingerprint test sees through it immediately. Camoufox is a patched Firefox
that spoofs the fingerprint at the C++ level — screen, fonts, WebGL,
navigator, timezone — so a page cannot tell it is automated from JavaScript.

It carries a ~600 MB browser, so nothing is downloaded at install time. The
engine fetches it on first use and **keeps it current on its own**: Camoufox
ships fingerprint fixes as anti-bot vendors adapt, so a stale build is a
degraded build. Missing is always downloaded; outdated is checked at most once
a day (one GitHub API call) and a failed check never breaks a working install.

```bash
DRAZTA_CAMOUFOX_AUTO_UPDATE=0     # pin the current build
DRAZTA_CAMOUFOX_UPDATE_HOURS=24   # how often to check
CAMOUFOX_INSTALL_DIR=/opt/camoufox
```

Because it is heavier than Chromium, `camoufox` sorts last on quality and only
leads when `stealth` is actually required — which is exactly what a 403 or an
anti-bot wall asks for when it triggers a re-plan.

*Verified live:* reports a genuine Firefox 152 user-agent (Playwright reports
Chrome), and bot.sannysoft.com's own WebDriver probe returns
`missing (passed)`.

## Safety: SSRF

A scraper takes a URL from an untrusted caller and fetches it. That is the
textbook SSRF shape: without a check, `http://169.254.169.254/` hands over
cloud credentials and `http://localhost:6379/` reaches the Redis next door.
Validating the URL string is not enough — a public hostname can resolve to a
private address, and a public URL can redirect to one.

So `safeFetch` resolves the hostname and refuses non-public addresses, follows
redirects **manually** while re-checking every hop, and carries cookies across
those hops so consent/session chains still work.

```bash
DRAZTA_ALLOW_PRIVATE_IPS=1   # opt out, to scrape a local dev server on purpose
```

## Output quality

The difference between a scraper and a good scraper is what survives to the
output.

- **Judged on text, not bytes.** Quality is evaluated after parsing, on the
  extracted text. A page can be 200 OK with 60 KB of HTML and no article; byte
  counts cannot see that.
- **Never silently empty.** If main-content scoping comes up thin, the scope
  widens back out. If every engine is rejected but one produced text, that text
  is returned with `metadata.degraded` set — flagged, not disguised.
- **Never confidently wrong.** Binary bodies are detected by magic bytes even
  when the server mislabels them, and refused with `UnsupportedContentError`
  rather than run through an HTML parser.
- **Usable links and images.** Lazy `data-src` is promoted, `srcset` resolves
  to the largest candidate, and every `href`/`src` is absolutized — markdown
  that leaves the scraper still points somewhere.
- **Real chrome removal.** ~50 selectors with a force-include guard, so a
  wrapper classed `.widget` that happens to contain the article (or a data
  `<table>`) is spared.
- **Honest dedup.** `canonicalKey()` is a dedup key separate from the fetchable
  URL: `www`/`http`/`:443`/`index.html`/trailing-slash/`utm_*` variants collapse
  to one, while `?page=2` and SPA `#/routes` stay distinct.
- **SEO-standard metadata.** `canonical`, `og:image`, `siteName`, `section`,
  `author` (social-profile URLs rejected), `favicon`, `publishedDate`.

Some URLs are public but only ever serve an app shell to a scraper while a
plain-HTML export sits next to them — Google Docs, Sheets, Slides and Drive are
rewritten to their export endpoints before fetching.

## Discovery — map and crawl

```ts
import { mapSite, crawl } from "drazta";

const urls = await mapSite("https://example.com", { limit: 100 });
const { documents } = await crawl("https://example.com/blog", {
  prefix: "https://example.com/blog",
  maxDepth: 2,
  limit: 30,
  concurrency: 5,
});
```

`crawl` is a same-site BFS over a concurrency-limited queue, deduped by
canonical key. `mapSite` reads `robots.txt` for `Sitemap:` directives plus
`sitemap.xml` (following one index level) and falls back to homepage links.

## Universal extractors — one code path, many sites

The hard problem: CNN, Detik, Kompas and CNBC lay out their HTML differently,
yet you want the same structured record from each without per-site code.
The trick is to lean on the **standards they all emit for SEO**:

```
1. schema.org JSON-LD  → headline, author, datePublished, body …
2. Open Graph / <meta>  → og:title, article:author, …
3. Readability-lite     → main-content body when JSON-LD lacks it
```

```ts
import { scrapeUrl, extractArticle, extractProduct } from "drazta";

const doc = await scrapeUrl(url, { formats: ["rawHtml"] });
extractArticle(doc); // { title, author, publishedDate, body, sources, … }
extractProduct(doc); // { name, brand, price, currency, availability, sku, … }
```

Every field records which layer produced it. Verified live against CNN, Detik,
Kompas and CNBC Indonesia, and on a WooCommerce store — one function, identical
output shape, no per-site code and no LLM.

**On hardened marketplaces (e.g. Tokopedia):** they return `503`/challenges to
plain HTTP and detect headless browsers. Drazta *detects* the block and asks for
stealth; getting *through* needs residential proxies — register that as one more
`FetchEngine` with `stealth: true` and routing handles the rest. The extractors
above still apply once you have the HTML.

## Tables → tidy → one dataset

Statistics sites keep the payload in tables, not prose.

```ts
import { extractTables, largestTable, tidyTable, deepExtract } from "drazta";

const t = tidyTable(largestTable(doc)!, { snakeCase: true });
// t.columns -> [{name:"population", type:"number"}, {name:"date", type:"date"}]
// t.rows[0] -> { location:"India", population:1429404000, date:"2026-07-01" }
```

`tidyTable` infers a type per column, coerces cells, strips footnote markers
(`[4]`), and drops blanks to `null`. The number parser disambiguates `"1.250"`
(1250) from `"4.8"` and `"8,232,000,000"`, so Indonesian and US formats both
land correctly.

Data is often spread across pages — one per year, per region, or paginated.
`deepExtract` scrapes them concurrently and merges:

```ts
// UNION — stack rows from paginated pages, tag the source.
await deepExtract(pages, { merge: "union", sourceColumn: "page" });

// JOIN — widen by a key: inflation per province, one page per year.
await deepExtract(
  [{ url: ".../2023", label: "2023" }, { url: ".../2024", label: "2024" }],
  { merge: "join", key: "provinsi" },  // -> { provinsi, inflasi_2023, inflasi_2024 }
);
```

`key: "@first"` joins on each table's first column. Missing cells become `null`,
a page with no table is reported but never fails the batch, and `matchedKeys`
tells you how many keys appeared in more than one source. Verified live: joined
Wikipedia's population and GDP tables by country — **194 countries matched**.

## Land it in DuckDB

```ts
import { DuckDBDatasetStore } from "drazta";

const db = await DuckDBDatasetStore.open("data.duckdb"); // or ":memory:"
await db.createFromTidy("countries", table, { replace: true });
const top = await db.query(`
  SELECT location, round(imf_2026_gdp*1e6 / population_pop, 0) AS gdp_per_capita
  FROM countries WHERE population_pop > 5000000
  ORDER BY gdp_per_capita DESC LIMIT 10
`);
await db.exportCsv("countries", "countries.csv");
```

Column types carry over, NULLs are preserved, BigInt/DATE results are normalized
to plain JS values. DuckDB is an optional dependency, loaded lazily.

## Deterministic LLM extraction

Calling an LLM on every page is non-deterministic and costly. Instead the LLM
**writes an extractor once**; the code is cached and every later page runs pure
deterministic code.

```
first page:  HTML → LLM writes extract(document) → cache → sandbox → JSON
later pages: HTML → cached extractor → sandbox → JSON        (no LLM)
```

```ts
const data = await extractStructured({
  document: docWithHtml,     // scrape with formats: ["rawHtml"] or ["html"]
  schema: z.object({ title: z.string().nullable() }),
  prompt: "the article headline",
  llm,
  strategy: "deterministic",
});
```

- **Sandbox** — jsdom with `runScripts: "outside-only"` (the page's own scripts
  never run), a `vm` context, a JSON realm boundary, and sync+async timeouts.
  `SandboxRunner` is a port, so a hardened jail (isolated-vm, an external
  service) is a drop-in swap. The default runner is *not* a security boundary
  against hostile generated code.
- **Self-repair** — statically detects too-strict `>` selectors matching zero
  elements and regenerates once with precise feedback.
- **Fail honestly** — a sandbox throw or schema mismatch triggers one
  regeneration; a second failure propagates rather than returning empty data.
- **Cache** — memory or file backend, keyed by
  `hash(version + model + url + schema + prompt)`.

## Dates

News dates arrive as `16 Juni 2026`, `04 August 2026 09:00`, or ISO. Rather
than trust an LLM to normalize, the pipeline pulls a machine-readable date
deterministically: JSON-LD `datePublished` → `<meta article:published_time>` →
`<time datetime>`.

```ts
normalizeDate("16 Juni 2026").date;        // "2026-06-16"
normalizeDate("04 August 2026 09:00").iso; // "2026-08-04T09:00:00"
```

Understands ISO, English and Indonesian month names, day-first numerics, and
compact URL timestamps. The principle throughout: **deterministic where
possible, LLM only as fallback.**

## Running many jobs at once

```ts
import { JobManager, createDefaultHandlers } from "drazta";

const mgr = new JobManager({ handlers: createDefaultHandlers(), concurrency: 4 });
const results = await mgr.submitAndRun([
  { kind: "article", input: { url: "https://finance.detik.com/..." } },
  { kind: "product", input: { url: "https://shop.example/p/123" } },
  { kind: "agent",   input: { task: "berita ekonomi syariah di CNBC jadi Excel" } },
]);
```

```bash
npm run jobs -- jobs.json --concurrency 4 --out results.json
```

The pool is bounded, a failing job is isolated so siblings keep running, and
status is queryable live (`mgr.status(id)`). `JobStore` is a port — swap the
in-memory one for Postgres/Redis later.

## The agent

```bash
OPENAI_API_KEY=... npm run agent -- "berita ekonomi syariah di CNBC, jadikan Excel"
```

```ts
const { files, records } = await runAgent({
  task: "collect Islamic-economy news from CNBC Indonesia into an Excel file",
});
// files[0].bytes -> the .xlsx
```

```
NL task → LLM plans → map_site → scrape_pages → extract_records → export_xlsx
```

Each tool stashes big artifacts in an `AgentSession` and returns only compact
summaries, so page content never floods the model context.

## Layout

| Path | Role |
|------|------|
| `src/types.ts` | Domain types (`Document`, `ScrapeOptions`, `RawResult`) |
| `src/core/ports.ts` | The extension seams — all interfaces, feature flags |
| `src/core/scrape.ts` | `scrapeUrl` — capability routing, hedging, re-planning |
| `src/core/errors.ts` | Error taxonomy; every error answers `fatal` |
| `src/core/extract.ts` | `extractStructured` — LLM → Zod schema |
| `src/core/{map,crawl}.ts` | Sitemap discovery and same-site BFS crawl |
| `src/engines/*` | Fetch strategies + scoring registry + resilience |
| `src/pipeline/*` | The single deterministic parse stack |
| `src/extract/*` | article · product · tables · tidy · deep · deterministic |
| `src/lib/safeFetch.ts` | SSRF-checked HTTP with a cookie jar |
| `src/lib/{urls,dates,coerce}.ts` | Canonicalization and data taming |
| `src/jobs/*` | Bounded concurrent job pool |
| `src/store/duckdb.ts` | DuckDB landing store (optional dep) |
| `src/export/*` | Output sinks: markdown, json, **xlsx** |
| `src/server/api.ts` | Hono REST API |
| `ui/server/api/*` | Nitro routes — the console's thin wrapper over the use-cases |
| `ui/app/*` | Nuxt 4 + Tailwind 4 console: pages, provenance stamps, receipts |

## Tests

```bash
npm test              # 134 checks across 13 files — no API key, no network
npm run test:live     # 16 checks against the real web (news, Wikipedia, stores)
npm run test:camoufox # 8 checks: stealth install, update throttle, fingerprint
npm run test:duck   # requires the optional @duckdb/node-api dep
```

Fake engines, fake scrapers and a fake LLM make the whole
map → scrape → extract → xlsx pipeline verifiable deterministically; the final
workbook is reopened and asserted. The engine suite covers capability routing,
hedging (asserting the hedged engine actually wins on wall-clock), abort
propagation, re-planning, the error taxonomy, and the SSRF guard.

## Roadmap

- [ ] A page cache as a first-class engine (tried first, misses waterfall)
- [ ] A hardened `SandboxRunner` (isolated-vm)
- [ ] Residential proxy support for the stealth engine
- [ ] Distributed queue (BullMQ/Redis) behind the `JobStore` port
- [ ] A `search` tool for the agent

## License

MIT © Muhammad Apriandito
