import TurndownService from "turndown";
// @ts-expect-error - no types shipped for this plugin
import { gfm } from "joplin-turndown-plugin-gfm";
import type { Transformer, TransformContext } from "../core/ports.js";
import type { Document } from "../types.js";
import { hasFormat, needsMarkdown } from "../core/formats.js";

/**
 * The single canonical HTML→Markdown converter. Every document — no matter
 * which engine produced it — passes through THIS one converter, which is why
 * output is consistent across engines. Swap the implementation here (e.g. a Go
 * service) and every path changes at once.
 */

function buildConverter(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  td.use(gfm);
  td.addRule("stripEmptyLinks", {
    filter: (node) =>
      node.nodeName === "A" && !node.getAttribute("href")?.trim(),
    replacement: (content) => content,
  });
  return td;
}

const converter = buildConverter();

function postProcess(md: string): string {
  return md
    .replace(/\[Skip to (?:main )?content\]\(#[^)]*\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Standalone HTML→Markdown using the same canonical converter + post-processing. */
export function convertHtmlToMarkdown(html: string): string {
  if (!html) return "";
  return postProcess(converter.turndown(html));
}

export const htmlToMarkdown: Transformer = {
  name: "htmlToMarkdown",
  transform(doc: Document, ctx: TransformContext): Document {
    if (!needsMarkdown(ctx.options.formats)) return doc;
    if (doc.html === undefined) {
      throw new Error("htmlToMarkdown: html missing (transformer out of order)");
    }

    if (doc.metadata.contentType?.includes("application/json")) {
      doc.markdown = "```json\n" + doc.rawHtml + "\n```";
      return doc;
    }

    doc.markdown = postProcess(converter.turndown(doc.html));

    // Last-resort anti-empty guard. cleanHtml already widens its scope when
    // main-content extraction comes up thin, so reaching here means the
    // cleaned DOM itself converted to nothing. Strip scripts/styles from the
    // raw HTML before converting — feeding turndown raw <script> bodies turns
    // an empty page into a page full of JavaScript, which is worse.
    if ((!doc.markdown || doc.markdown.length === 0) && doc.rawHtml) {
      ctx.log("markdown empty after conversion; retrying against raw html");
      const stripped = doc.rawHtml.replace(
        /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi,
        "",
      );
      doc.markdown = postProcess(converter.turndown(stripped));
    }

    return doc;
  },
};

export { hasFormat };
