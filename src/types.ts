/**
 * Core domain types. These are deliberately provider-agnostic: nothing here
 * knows about a specific engine, LLM, or output format.
 */

export type OutputFormat =
  | "markdown"
  | "html"
  | "rawHtml"
  | "links"
  | "metadata"
  | "json";

export interface ScrapeOptions {
  /** Which fields to compute and return. Defaults to ["markdown"]. */
  formats?: OutputFormat[];
  /** Strip nav/aside/footer/scripts and keep the main content only. */
  onlyMainContent?: boolean;
  /**
   * Total budget for the whole scrape, in milliseconds — every engine, every
   * retry and every re-plan draws from it. NOT a per-attempt allowance: pass
   * 60000 and the call returns within roughly 60s, rather than 60s multiplied
   * by however many attempts the waterfall happened to make. Default 120000.
   */
  timeoutMs?: number;
  /** Force a specific engine by name instead of the fallback list. */
  engine?: string;
  /** Extra headers forwarded to the fetch layer. */
  headers?: Record<string, string>;
  /** Hint that the page needs a real browser (JS-rendered). */
  requiresJs?: boolean;
  /** Wait this long for late-rendering content before reading the DOM. */
  waitForMs?: number;
  /**
   * Run browser engines with a visible window. Defaults to true (headless);
   * set false to watch a scrape happen, which is the fastest way to see why a
   * page is not yielding what you expected. Env: DRAZTA_HEADLESS=0.
   * Ignored by the plain `fetch` engine, which has no window.
   */
  headless?: boolean;
  /**
   * Capabilities this request requires, beyond what the other options imply.
   * Engines are ranked by how well they cover them. See core/ports.ts.
   */
  features?: import("./core/ports.js").FeatureFlag[];
}

export interface DocumentMetadata {
  url: string;
  sourceURL?: string;
  statusCode?: number;
  title?: string;
  description?: string;
  language?: string;
  contentType?: string;
  /** Canonical publish date "YYYY-MM-DD", deterministically derived if found. */
  publishedDate?: string;
  /** Full ISO publish timestamp when available (from JSON-LD/meta/time). */
  publishedTime?: string;
  /** The page's own <link rel=canonical>. Better dedup key than the request URL. */
  canonical?: string;
  ogImage?: string;
  ogType?: string;
  siteName?: string;
  section?: string;
  keywords?: string;
  author?: string;
  favicon?: string;
  /** True when the returned html was successfully scoped to the main content. */
  mainContent?: boolean;
  /**
   * Visible-text length the pipeline measured. Survives format coercion, so
   * quality stays measurable even when the body fields are stripped.
   */
  textLength?: number;
  /** Set when the URL was rewritten before fetching (e.g. Google Docs export). */
  rewrittenUrl?: string;
  /**
   * Set when every engine rejected the page and the best partial result was
   * returned anyway. Its presence means: treat this content with suspicion.
   */
  degraded?: string;
  /** Name of the engine that actually produced the raw HTML. */
  engine?: string;
  [key: string]: unknown;
}

/** The single, unified shape every scrape resolves to — regardless of engine. */
export interface Document {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  json?: unknown;
  metadata: DocumentMetadata;
}

/** What an engine returns: raw material only. Engines never parse. */
export interface RawResult {
  rawHtml: string;
  statusCode?: number;
  contentType?: string;
  /** The final URL after redirects, if the engine can observe it. */
  resolvedUrl?: string;
}
