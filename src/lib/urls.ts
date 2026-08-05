/** URL utilities for crawling: normalization, same-site checks, filtering. */

export function normalizeUrl(input: string, base?: string): string | null {
  try {
    const u = new URL(input, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = ""; // fragments never identify a distinct document
    // Drop trailing slash on non-root paths for stable dedup.
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Query params that identify a campaign/click, never a document. Stripping them
 * is what makes `?utm_source=fb` and the bare URL collapse to one crawl target.
 * Deliberately a prefix/exact list — pagination (`?page=2`) must survive.
 */
const TRACKING_PARAMS: RegExp[] = [
  /^utm_/i,
  /^ga_/i,
  /^_ga$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^fbclid$/i,
  /^msclkid$/i,
  /^mc_(cid|eid)$/i,
  /^igshid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^referrer$/i,
  /^source$/i,
  /^spm$/i,
  /^yclid$/i,
];

const INDEX_FILES = [
  "/index.html",
  "/index.htm",
  "/index.php",
  "/index.shtml",
  "/index.xml",
];

/**
 * The DEDUP key for a URL — deliberately more aggressive than normalizeUrl,
 * which still has to produce something fetchable. Two URLs sharing a
 * canonicalKey are the same document, so a crawler should fetch only one.
 *
 *   http://www.x.com/a/index.html?utm_source=fb  ─┐
 *   https://x.com/a/                              ├─► "https://x.com/a"
 *   https://x.com:443/a?utm_campaign=x            ─┘
 *
 * Never use the result as a fetch target: the scheme is forced to https and
 * the host loses "www.", neither of which is guaranteed to resolve.
 */
export function canonicalKey(input: string, base?: string): string | null {
  try {
    const u = new URL(input, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;

    // A hash only identifies a distinct document for client-side routers.
    u.hash =
      u.hash.startsWith("#/") || u.hash.startsWith("#!/") ? u.hash : "";

    u.protocol = "https:";
    if (u.port === "80" || u.port === "443") u.port = "";
    if (u.hostname.startsWith("www.")) u.hostname = u.hostname.slice(4);

    const idx = INDEX_FILES.find((f) => u.pathname.endsWith(f));
    if (idx) u.pathname = u.pathname.slice(0, -(idx.length - 1));
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }

    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
    }
    u.searchParams.sort(); // param order is not identity

    return u.toString();
  } catch {
    return null;
  }
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Same registrable host, ignoring a leading "www." on either side. */
export function sameSite(a: string, b: string): boolean {
  const ha = hostOf(a)?.replace(/^www\./, "");
  const hb = hostOf(b)?.replace(/^www\./, "");
  return !!ha && ha === hb;
}

export function matchesPrefix(url: string, prefix?: string): boolean {
  if (!prefix) return true;
  const n = normalizeUrl(url);
  const p = normalizeUrl(prefix);
  return !!n && !!p && n.startsWith(p);
}

export interface UrlFilter {
  /** Only keep URLs on the same site as the seed. Default true. */
  sameSiteOnly?: boolean;
  /** Only keep URLs under this path prefix, e.g. "https://x.com/blog". */
  prefix?: string;
  /** Regexes a URL must match at least one of (if provided). */
  include?: RegExp[];
  /** Regexes that exclude a URL if any match. */
  exclude?: RegExp[];
}

export function makeUrlFilter(seed: string, filter: UrlFilter = {}) {
  const { sameSiteOnly = true, prefix, include, exclude } = filter;
  return (url: string): boolean => {
    if (sameSiteOnly && !sameSite(seed, url)) return false;
    if (!matchesPrefix(url, prefix)) return false;
    if (exclude && exclude.some((re) => re.test(url))) return false;
    if (include && include.length > 0 && !include.some((re) => re.test(url)))
      return false;
    return true;
  };
}
