import * as cheerio from "cheerio";
import type { Transformer, TransformContext } from "../core/ports.js";
import type { Document } from "../types.js";

/** Never carries content. Removed unconditionally, before anything else. */
const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "template",
  "link",
  "object",
  "embed",
];

/**
 * Page chrome: present on nearly every site, never the article. Removed only
 * when onlyMainContent is on. Kept as a broad list rather than trusting
 * <main>/<article> alone, because plenty of sites nest nav/share/related
 * widgets *inside* their semantic main element.
 */
const CHROME_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  ".header",
  "#header",
  ".navbar",
  ".nav",
  "#nav",
  ".navigation",
  ".menu",
  ".footer",
  "#footer",
  ".sidebar",
  "#sidebar",
  ".side",
  ".aside",
  ".breadcrumb",
  ".breadcrumbs",
  "#breadcrumbs",
  ".share",
  "#share",
  ".social",
  ".social-media",
  ".social-links",
  ".related",
  ".related-post",
  ".related-posts",
  ".recommendation",
  ".newsletter",
  ".subscribe",
  ".comment",
  ".comments",
  "#comments",
  ".ad",
  ".ads",
  ".advert",
  ".advertisement",
  "#ad",
  ".banner",
  ".sponsor",
  ".popup",
  ".modal",
  "#modal",
  ".overlay",
  ".cookie",
  "#cookie",
  ".cookie-consent",
  ".widget",
  "#widget",
  ".lang-selector",
  ".language",
  "#language-selector",
  ".skip-link",
  "[role=navigation]",
  "[role=banner]",
  "[role=complementary]",
  "[aria-hidden=true]",
];

/**
 * Selectors that mark real content. A chrome element containing one of these
 * is spared — this is the guard against a class like "widget" wrapping the
 * article itself and taking the whole page down with it.
 *
 * `table` is on the list because on statistics sites (BPS, Wikipedia, gov
 * portals) the payload IS the table, and those tables routinely sit in
 * containers named .widget / .sidebar-box. Removing one costs the entire
 * dataset, while keeping a layout table costs nothing: extractTables()
 * filters those out downstream by row/column count.
 */
const FORCE_INCLUDE = [
  "#main",
  "main",
  "article",
  "[itemprop=articleBody]",
  "table",
];

/** Attributes lazy-loaders park the real image URL in, in priority order. */
const LAZY_SRC_ATTRS = [
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-echo",
  "data-url",
];

/** Below this, main-content scoping is treated as having eaten the page. */
const MIN_SCOPE_TEXT = 200;

function textLength($: cheerio.CheerioAPI, scope?: cheerio.Cheerio<never>): number {
  const t = scope ? scope.text() : $.root().text();
  return t.replace(/\s+/g, " ").trim().length;
}

/**
 * Picks the largest candidate out of a srcset and promotes it to src, so the
 * markdown carries a usable image instead of a 1x placeholder.
 */
function resolveSrcset(srcset: string, currentSrc?: string): string | undefined {
  const candidates = srcset
    .split(",")
    .map((part) => {
      const [url, descriptor = "1x"] = part.trim().split(/\s+/);
      if (!url) return null;
      const n = parseFloat(descriptor);
      return {
        url,
        weight: Number.isFinite(n) ? n : 1,
        isDensity: descriptor.endsWith("x"),
      };
    })
    .filter((c): c is { url: string; weight: number; isDensity: boolean } => !!c);

  if (candidates.length === 0) return undefined;
  // An all-density srcset describes the same image; the existing src is a
  // legitimate 1x candidate and must compete rather than be discarded.
  if (currentSrc && candidates.every((c) => c.isDensity)) {
    candidates.push({ url: currentSrc, weight: 1, isDensity: true });
  }
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0].url;
}

/**
 * Rewrites every relative URL to absolute and un-lazies images, IN PLACE on
 * the parsed DOM. Runs before scoping so it covers the whole document.
 *
 * Without this, markdown from any page that uses root-relative links ends up
 * with `](/foo)` — links and images that resolve nowhere once the markdown
 * leaves the scraper.
 */
function absolutize($: cheerio.CheerioAPI, base: string): void {
  const abs = (value: string): string | undefined => {
    const v = value.trim();
    if (!v || v.startsWith("data:") || v.startsWith("#")) return undefined;
    try {
      return new URL(v, base).toString();
    } catch {
      return undefined;
    }
  };

  $("img").each((_, el) => {
    const $el = $(el);
    // Un-lazy first. A data-src wins over src unconditionally: a page that
    // sets one is lazy-loading, which means src holds a spacer gif, a blur
    // placeholder or a data: URI — never the image the reader sees.
    for (const attr of LAZY_SRC_ATTRS) {
      const v = $el.attr(attr)?.trim();
      if (v) {
        $el.attr("src", v);
        $el.removeAttr(attr);
        break;
      }
    }
    const srcset = $el.attr("srcset") ?? $el.attr("data-srcset");
    if (srcset) {
      const best = resolveSrcset(srcset, $el.attr("src"));
      if (best) $el.attr("src", best);
    }
    const src = $el.attr("src");
    if (src) {
      const a = abs(src);
      if (a) $el.attr("src", a);
    }
    $el.removeAttr("srcset").removeAttr("data-srcset");
  });

  $("a[href]").each((_, el) => {
    const a = abs($(el).attr("href") ?? "");
    if (a) $(el).attr("href", a);
  });
}

/** Removes chrome from a subtree, sparing anything wrapping real content. */
function stripChrome($: cheerio.CheerioAPI, root: cheerio.Cheerio<never>): void {
  const guard = FORCE_INCLUDE.map((s) => `:not(:has(${s}))`).join("");
  for (const selector of CHROME_SELECTORS) {
    try {
      root.find(selector).filter(guard).remove();
    } catch {
      // A selector cheerio can't compile must not take the whole scrape down.
    }
  }
}

/**
 * Normalizes raw HTML into cleaned HTML (document.html). Always strips noise,
 * un-lazies images and absolutizes every URL. When onlyMainContent is on it
 * prefers <main>/<article> and strips page chrome — but verifies the result
 * still has text, and widens back out if scoping ate the page.
 *
 * Runs BEFORE markdown so every engine feeds the same cleaned DOM into the
 * converter — this is the root of cross-engine consistency.
 */
export const cleanHtml: Transformer = {
  name: "cleanHtml",
  transform(doc: Document, ctx: TransformContext): Document {
    if (doc.rawHtml === undefined) {
      throw new Error("cleanHtml: rawHtml missing (transformer out of order)");
    }

    if (doc.metadata.contentType?.includes("application/json")) {
      // Leave JSON payloads untouched; the markdown step fences them.
      doc.html = doc.rawHtml;
      doc.metadata.textLength = doc.rawHtml.trim().length;
      return doc;
    }

    const $ = cheerio.load(doc.rawHtml);
    $(NOISE_SELECTORS.join(",")).remove();
    $.root()
      .find("*")
      .contents()
      .filter((_, n) => n.type === "comment")
      .remove();

    absolutize($, doc.metadata.url ?? ctx.url);

    const onlyMain = ctx.options.onlyMainContent === true;
    if (!onlyMain) {
      doc.metadata.mainContent = false;
      doc.metadata.textLength = textLength($);
      doc.html = $.html();
      return doc;
    }

    const main = $("main").first();
    const article = $("article").first();
    const scope = (main.length ? main : article.length ? article : null) as
      | cheerio.Cheerio<never>
      | null;

    if (scope) {
      // Chrome nested inside <main>/<article> is common (share bars, related
      // widgets), so scoping alone is not enough.
      stripChrome($, scope);
      const scopeChars = textLength($, scope);
      if (scopeChars >= MIN_SCOPE_TEXT) {
        doc.metadata.mainContent = true;
        doc.metadata.textLength = scopeChars;
        doc.html = $.html(scope);
        return doc;
      }
      ctx.log(
        "main-content scope too thin; widening to full body",
        { chars: textLength($, scope) },
      );
    }

    // No semantic main element, or scoping produced nothing usable: strip
    // chrome from the body instead.
    const body = ($("body").length ? $("body") : $.root()) as cheerio.Cheerio<never>;
    const beforeChars = textLength($);
    stripChrome($, body);

    if (textLength($) < MIN_SCOPE_TEXT && beforeChars >= MIN_SCOPE_TEXT) {
      // Chrome removal itself ate the page — the site labels its content with
      // chrome-ish class names. Better a noisy page than an empty one.
      ctx.log("chrome removal emptied the page; falling back to raw");
      doc.metadata.mainContent = false;
      const $raw = cheerio.load(doc.rawHtml);
      $raw(NOISE_SELECTORS.join(",")).remove();
      absolutize($raw, doc.metadata.url ?? ctx.url);
      doc.metadata.textLength = textLength($raw);
      doc.html = $raw.html();
      return doc;
    }

    doc.metadata.mainContent = false;
    doc.metadata.textLength = textLength($);
    doc.html = $.html();
    return doc;
  },
};
