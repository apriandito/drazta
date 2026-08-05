import type { TidyColumn } from "~/types/api";

/** RFC 4180 quoting: wrap when the value could otherwise break a row. */
function escape(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  columns: TidyColumn[],
  rows: Record<string, string | number | null>[],
): string {
  const head = columns.map((c) => escape(c.name)).join(",");
  const body = rows.map((row) => columns.map((c) => escape(row[c.name] ?? null)).join(","));
  return [head, ...body].join("\r\n");
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBase64(filename: string, base64: string, mime: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** A filesystem-safe stem from a URL, e.g. "en.wikipedia.org-List_of_countries". */
export function slugFromUrl(url: string, fallback = "drazta"): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return `${u.hostname}${last ? `-${last}` : ""}`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  } catch {
    return fallback;
  }
}
