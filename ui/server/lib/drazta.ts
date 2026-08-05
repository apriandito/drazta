/**
 * The single seam between this app and the library.
 *
 * The console talks to Drazta as a library, not over HTTP — there is no second
 * process to run. It imports the *built* output, so `npm run build` at the repo
 * root must have run first (the root `npm run ui` script does it for you).
 */
export {
  scrapeUrl,
  mapSite,
  crawl,
  extractArticle,
  extractProduct,
  extractTables,
  largestTable,
  tidyTable,
  deepExtract,
  runAgent,
  engines,
  buildFallbackList,
  requiredFeatures,
  FEATURE_PRIORITY,
} from "#drazta";

export type {
  Document,
  DocumentMetadata,
  OutputFormat,
  ScrapeOptions,
  Article,
  Product,
  ExtractedTable,
  TidyTable,
  TidyColumn,
  DeepExtractResult,
  MapEntry,
  CrawlResult,
  FeatureFlag,
} from "#drazta";
