import * as cheerio from "cheerio";
import type { Transformer } from "../core/ports.js";
import type { Document } from "../types.js";
import { normalizeDate } from "../lib/dates.js";

/**
 * Find a publish date from machine-readable sources, in order of reliability:
 * JSON-LD datePublished -> <meta article:published_time> -> <time datetime>.
 * Deterministic; no LLM. Returns the first that normalizes cleanly.
 */
function findPublishDate(
  $: cheerio.CheerioAPI,
): { publishedDate?: string; publishedTime?: string } {
  const candidates: string[] = [];

  // 1. JSON-LD (most reliable — usually already ISO with offset).
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    const m = /"datePublished"\s*:\s*"([^"]+)"/.exec(raw);
    if (m) candidates.push(m[1]);
  });

  // 2. Open Graph / article meta.
  const meta =
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[itemprop="datePublished"]').attr("content") ||
    $('meta[name="pubdate"]').attr("content");
  if (meta) candidates.push(meta);

  // 3. <time datetime="...">
  const timeAttr = $("time[datetime]").first().attr("datetime");
  if (timeAttr) candidates.push(timeAttr);

  for (const c of candidates) {
    const norm = normalizeDate(c);
    if (norm) return { publishedDate: norm.date, publishedTime: norm.iso };
  }
  return {};
}

/** Author from the standards sites already emit for SEO. Social-profile URLs
 * masquerading as authors are rejected — a common failure on news templates. */
function findAuthor($: cheerio.CheerioAPI): string | undefined {
  const candidates = [
    $('meta[name="author"]').attr("content"),
    $('meta[property="article:author"]').attr("content"),
    $('meta[name="byl"]').attr("content"),
    $('[itemprop="author"] [itemprop="name"]').first().text(),
    $('[rel="author"]').first().text(),
  ];
  for (const raw of candidates) {
    const v = raw?.trim();
    if (!v || v.length > 120) continue;
    if (/^https?:\/\//i.test(v)) continue; // an author is a name, not a profile URL
    return v;
  }
  return undefined;
}

/** Derives title/description/language/publishDate and the SEO-standard fields
 * (canonical, og:*, author, favicon) from raw HTML. Deterministic; no LLM. */
export const deriveMetadata: Transformer = {
  name: "deriveMetadata",
  transform(doc: Document): Document {
    if (doc.rawHtml === undefined) return doc;
    const $ = cheerio.load(doc.rawHtml);
    const base = doc.metadata.url;

    const pick = (sel: string, attr = "content"): string | undefined =>
      $(sel).first().attr(attr)?.trim() || undefined;

    const absolute = (v?: string): string | undefined => {
      if (!v || !base) return v;
      try {
        return new URL(v, base).toString();
      } catch {
        return v;
      }
    };

    doc.metadata = {
      ...doc.metadata,
      title:
        $("title").first().text().trim() ||
        pick('meta[property="og:title"]') ||
        doc.metadata.title,
      description:
        pick('meta[name="description"]') ||
        pick('meta[property="og:description"]') ||
        doc.metadata.description,
      language:
        $("html").attr("lang")?.trim() ||
        pick('meta[http-equiv="content-language"]') ||
        doc.metadata.language,
      // The site's own statement of which URL this page really is — more
      // reliable for dedup than anything derived from the request URL.
      canonical: absolute(pick('link[rel="canonical"]', "href")),
      ogImage: absolute(
        pick('meta[property="og:image"]') ||
          pick('meta[name="twitter:image"]'),
      ),
      ogType: pick('meta[property="og:type"]'),
      siteName: pick('meta[property="og:site_name"]'),
      section: pick('meta[property="article:section"]'),
      keywords: pick('meta[name="keywords"]'),
      author: findAuthor($),
      favicon: absolute(
        pick('link[rel="icon"]', "href") ||
          pick('link[rel="shortcut icon"]', "href") ||
          pick('link[rel="apple-touch-icon"]', "href"),
      ),
      ...findPublishDate($),
    };
    return doc;
  },
};
