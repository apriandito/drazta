import { engines, FEATURE_PRIORITY } from "../lib/drazta";

/**
 * What the seer can actually reach for right now.
 *
 * `FetchEngine` has no availability method — the browser engine decides that
 * privately at fetch time — so the console probes the optional dependency
 * itself rather than claiming a capability it has not verified. Only engines
 * backed by an optional module are probed; the rest ship with the library and
 * are always there.
 */
const OPTIONAL_MODULE: Record<string, string> = {
  playwright: "playwright",
};

async function installed(mod: string): Promise<boolean> {
  try {
    await import(/* @vite-ignore */ mod);
    return true;
  } catch {
    return false;
  }
}

export default defineEventHandler(async () => {
  const list = await Promise.all(
    engines.map(async (engine) => {
      const optional = OPTIONAL_MODULE[engine.name];
      return {
        name: engine.name,
        quality: engine.quality,
        features: engine.features,
        optional: Boolean(optional),
        installed: optional ? await installed(optional) : true,
      };
    }),
  );
  return { engines: list, priority: FEATURE_PRIORITY };
});
