import { lookup } from "node:dns/promises";
import { BlockedAddressError, classifyFetchError } from "../core/errors.js";

/**
 * HTTP with the guarantees a public-facing scraper needs.
 *
 * A scraper takes a URL from an untrusted caller and fetches it. That is the
 * textbook SSRF shape: without a check, `http://169.254.169.254/` hands over
 * cloud credentials and `http://localhost:6379/` reaches the Redis next door.
 * Validating the URL string is not enough — a public hostname can resolve to
 * a private address, and a public URL can redirect to one.
 *
 * So this module:
 *   1. resolves the hostname and refuses non-public addresses,
 *   2. follows redirects MANUALLY, re-checking every hop,
 *   3. carries cookies across those hops, so consent/session redirects work.
 *
 * Set SCRAPEFLOW_ALLOW_PRIVATE_IPS=1 to scrape a local dev server on purpose.
 */

function allowPrivate(): boolean {
  return process.env.SCRAPEFLOW_ALLOW_PRIVATE_IPS === "1";
}

/** Parse dotted-quad IPv4 into its 32-bit value, or null if it isn't one. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

/** CIDR blocks that are not routable on the public internet. */
const PRIVATE_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — the cloud metadata endpoint lives here
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

export function isPrivateAddress(address: string): boolean {
  const addr = address.toLowerCase();

  // IPv4-mapped IPv6 ("::ffff:127.0.0.1") is just IPv4 wearing a hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  const v4 = ipv4ToInt(mapped ? mapped[1] : addr);
  if (v4 !== null) {
    for (const [base, bits] of PRIVATE_V4) {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((v4 & mask) === (ipv4ToInt(base)! & mask)) return true;
    }
    return false;
  }

  if (addr === "::" || addr === "::1") return true; // unspecified, loopback
  if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(addr)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(addr)) return true; // ff00::/8 multicast
  return false;
}

/** Resolves a hostname and throws unless every answer is publicly routable. */
async function assertPublicHost(url: URL): Promise<void> {
  if (allowPrivate()) return;

  const host = url.hostname.replace(/^\[|\]$/g, "");

  // A literal IP needs no lookup — and must not get one, or a DNS server
  // could answer differently than the address we are about to connect to.
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    if (isPrivateAddress(host)) throw new BlockedAddressError(url.toString(), host);
    return;
  }

  let answers: { address: string }[];
  try {
    answers = await lookup(host, { all: true });
  } catch (err) {
    throw classifyFetchError(err, url.toString());
  }

  for (const { address } of answers) {
    if (isPrivateAddress(address)) {
      throw new BlockedAddressError(url.toString(), address);
    }
  }
}

/** Minimal cookie jar: enough to survive a consent/session redirect chain. */
class Jar {
  private readonly cookies = new Map<string, string>();

  absorb(headers: Headers): void {
    // getSetCookie() keeps multiple Set-Cookie headers separate; a plain
    // get() would join them on ", " and corrupt any cookie with a comma.
    const raw =
      typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const line of raw) {
      const pair = line.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export interface SafeFetchResult {
  response: Response;
  /** The URL actually fetched after following redirects. */
  finalUrl: string;
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  maxRedirects?: number;
}

/**
 * fetch() with per-hop SSRF checks and cookie continuity. Returns the response
 * plus the final URL, since the caller needs the post-redirect URL to resolve
 * relative links correctly.
 */
export async function safeFetch(
  url: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const jar = new Jar();
  let current = new URL(url);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHost(current);

    const cookie = jar.header();
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual", // every hop is re-validated above
        signal: opts.signal,
        headers: {
          ...opts.headers,
          ...(cookie ? { cookie } : {}),
        },
      });
    } catch (err) {
      throw classifyFetchError(err, current.toString());
    }

    jar.absorb(res.headers);

    const location = res.headers.get("location");
    const isRedirect = res.status >= 300 && res.status < 400 && location;
    if (!isRedirect) {
      return { response: res, finalUrl: current.toString() };
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { response: res, finalUrl: current.toString() };
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      return { response: res, finalUrl: current.toString() };
    }
    current = next;
  }

  throw new Error(`Too many redirects (>${maxRedirects}) starting at ${url}`);
}
