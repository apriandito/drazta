/**
 * Convenience URL rewrites — "fake redirects" applied before fetching.
 *
 * Some URLs are perfectly public but serve a JavaScript application shell to a
 * scraper, while the same document has a plain-HTML export endpoint sitting
 * right next to it. Rewriting costs one regex and turns a guaranteed-empty
 * scrape into a full document, so it happens at the very top of scrapeUrl.
 *
 * Returns undefined when no rewrite applies — callers keep the original URL.
 */

const DOC_ID = /\/(?:document|presentation|spreadsheets)\/d\/([-\w]+)/;
const FILE_ID = /\/file\/d\/([-\w]+)/;

export function rewriteUrl(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }

  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname;

  if (host === "docs.google.com") {
    // "/d/e/" URLs are already-published HTML pages; rewriting breaks them.
    if (path.includes("/d/e/")) return undefined;

    const id = DOC_ID.exec(path)?.[1];
    if (!id) return undefined;

    if (path.startsWith("/document/")) {
      return `https://docs.google.com/document/d/${id}/export?format=html`;
    }
    if (path.startsWith("/presentation/")) {
      return `https://docs.google.com/presentation/d/${id}/export?format=html`;
    }
    if (path.startsWith("/spreadsheets/")) {
      // Preserve the selected tab — gid can live in the query or the fragment.
      const gid = /[?&#]gid=(\d+)/.exec(url)?.[1];
      return (
        `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:html` +
        (gid ? `&gid=${gid}` : "")
      );
    }
    return undefined;
  }

  if (host === "drive.google.com") {
    const id = FILE_ID.exec(path)?.[1];
    if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
    return undefined;
  }

  return undefined;
}
