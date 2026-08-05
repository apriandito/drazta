/**
 * The shapes the browser side works with. Deliberately hand-written rather
 * than imported from the library: these describe what crosses the wire (JSON,
 * already truncated for transport), not what the library holds in memory.
 */

export interface DocumentMetadata {
  url: string;
  sourceURL?: string;
  statusCode?: number;
  title?: string;
  description?: string;
  language?: string;
  contentType?: string;
  publishedDate?: string;
  publishedTime?: string;
  canonical?: string;
  ogImage?: string;
  siteName?: string;
  section?: string;
  author?: string;
  favicon?: string;
  mainContent?: boolean;
  textLength?: number;
  rewrittenUrl?: string;
  degraded?: string;
  engine?: string;
  [key: string]: unknown;
}

export interface ScrapedDocument {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  json?: unknown;
  metadata: DocumentMetadata;
}

export type FieldSource = "json-ld" | "meta" | "readability" | "none";

export interface Article {
  title: string | null;
  author: string | null;
  publishedDate: string | null;
  publishedTime: string | null;
  description: string | null;
  section: string | null;
  siteName: string | null;
  image: string | null;
  body: string | null;
  url: string;
  sources: Record<string, FieldSource>;
}

export interface Product {
  name: string | null;
  brand: string | null;
  price: number | null;
  currency: string | null;
  priceText: string | null;
  availability: string | null;
  rating: number | null;
  ratingCount: number | null;
  sku: string | null;
  image: string | null;
  description: string | null;
  url: string;
  sources: Record<string, "json-ld" | "meta" | "none">;
}

export type CellType = "number" | "percent" | "date" | "text";

export interface TidyColumn {
  name: string;
  type: CellType;
}

export interface TidyPreview {
  caption: string | null;
  columns: TidyColumn[];
  rows: Record<string, string | number | null>[];
  rowCount: number;
  truncated: boolean;
}

export interface TablePreview extends TidyPreview {
  index: number;
  colCount: number;
}

export interface MapEntry {
  url: string;
  source: "sitemap" | "links";
}

export interface CrawledPage {
  url: string;
  title: string | null;
  statusCode: number | null;
  engine: string | null;
  textLength: number | null;
  publishedDate: string | null;
  degraded: string | null;
}

export interface DeepSourceReport {
  url: string;
  label?: string;
  rowCount: number;
  error?: string;
}

export interface AgentFile {
  name: string;
  size: number;
  base64: string | null;
}

/** Every route answers in this envelope. See server/lib/respond.ts. */
export type Envelope<T> =
  | ({ ok: true; ms: number } & T)
  | { ok: false; ms: number; message: string; kind: string; fatal: boolean };

export type Failure = Extract<Envelope<object>, { ok: false }>;
