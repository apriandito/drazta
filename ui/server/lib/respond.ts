/**
 * One response envelope for every route, because the console's whole job is to
 * report honestly: how long it took, and — when it failed — what actually went
 * wrong rather than a generic 500.
 */

export type Envelope<T> =
  | ({ ok: true; ms: number } & T)
  | { ok: false; ms: number; message: string; kind: string; fatal: boolean };

/**
 * Drazta's errors carry a `fatal` flag and a `name` that names the failure
 * class. Pass both through — the UI distinguishes "this URL will never work"
 * from "this one just needs a browser".
 */
function describe(err: unknown): { message: string; kind: string; fatal: boolean } {
  if (err instanceof Error) {
    return {
      message: err.message,
      kind: err.name && err.name !== "Error" ? err.name : "Error",
      fatal: (err as Error & { fatal?: boolean }).fatal === true,
    };
  }
  return { message: String(err), kind: "Error", fatal: false };
}

/** Run a handler, timing it, and turn any failure into data the UI can render. */
export async function run<T extends object>(fn: () => Promise<T>): Promise<Envelope<T>> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    // Await first: in an object literal, `ms: elapsed()` would be evaluated
    // before the spread's await resolves, and every request would report 0.
    const value = await fn();
    return { ok: true, ms: elapsed(), ...value };
  } catch (err) {
    return { ok: false, ms: elapsed(), ...describe(err) };
  }
}

/** A bad request is the caller's mistake — say which field, and say it early. */
export class BadInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadInput";
  }
}

export function requireUrl(value: unknown, field = "url"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadInput(`${field} is required`);
  }
  const raw = value.trim();
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).toString();
  } catch {
    throw new BadInput(`${field} is not a valid URL: ${raw}`);
  }
}

/** Clamp a numeric option into a sane range instead of trusting the client. */
export function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
