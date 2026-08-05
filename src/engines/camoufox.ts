import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FetchEngine } from "../core/ports.js";
import type { RawResult, ScrapeOptions } from "../types.js";

/**
 * Camoufox — a real stealth engine.
 *
 * Playwright's Chromium hides `navigator.webdriver` and little else; hardened
 * marketplaces see through it instantly. Camoufox is a patched Firefox that
 * spoofs the fingerprint at the C++ level (screen, fonts, WebGL, navigator,
 * timezone), so the page cannot tell it is automated from JavaScript alone.
 *
 * It is an OPTIONAL dependency and the browser binary is ~600 MB, downloaded
 * on first use rather than at install time. Everything below is lazy: a
 * Drazta install without camoufox-js simply routes around this engine.
 *
 * Env:
 *   DRAZTA_CAMOUFOX_AUTO_UPDATE=0     disable update checks (default: on)
 *   DRAZTA_CAMOUFOX_UPDATE_HOURS=24   hours between update checks
 *   CAMOUFOX_INSTALL_DIR=...          relocate the browser (camoufox-js's own)
 */

/** Camoufox needs the Juggler protocol version its Firefox was built against,
 * which is why playwright-core is pinned rather than floating. */
type CamoufoxModule = {
  launchOptions: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
type PkgManModule = {
  installedVerStr: () => string;
  CamoufoxFetcher: new () => {
    init(): Promise<void>;
    install(): Promise<void>;
    readonly verstr: string;
  };
};

let available: boolean | null = null;

async function loadCamoufox(): Promise<CamoufoxModule | null> {
  if (available === false) return null;
  try {
    const mod = (await import("camoufox-js")) as unknown as CamoufoxModule;
    available = true;
    return mod;
  } catch {
    available = false;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------------

/**
 * Where the last update check is recorded. Kept outside the browser directory
 * so a reinstall (which wipes that directory) does not silently reset the
 * throttle, and in tmp so it never pollutes the user's project.
 */
const STAMP_FILE = join(tmpdir(), "drazta-camoufox-update.json");

function readStamp(): number {
  try {
    const raw = JSON.parse(readFileSync(STAMP_FILE, "utf8")) as { checkedAt?: number };
    return typeof raw.checkedAt === "number" ? raw.checkedAt : 0;
  } catch {
    return 0;
  }
}

function writeStamp(): void {
  try {
    mkdirSync(tmpdir(), { recursive: true });
    writeFileSync(STAMP_FILE, JSON.stringify({ checkedAt: Date.now() }));
  } catch {
    // A throttle we cannot persist just means we check again next run.
  }
}

function updatesEnabled(): boolean {
  return process.env.DRAZTA_CAMOUFOX_AUTO_UPDATE !== "0";
}

function updateIntervalMs(): number {
  const h = Number(process.env.DRAZTA_CAMOUFOX_UPDATE_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 24) * 3_600_000;
}

/** Result of an ensure pass — surfaced so callers can log what happened. */
export interface CamoufoxStatus {
  installed: string | null;
  latest?: string;
  action: "none" | "installed" | "updated" | "skipped" | "unavailable";
  error?: string;
}

let ensuring: Promise<CamoufoxStatus> | null = null;

/**
 * Makes sure a Camoufox browser is present and reasonably current.
 *
 * Two distinct cases, deliberately treated differently:
 *
 *  - **Missing** — we must download, or nothing can run. Always done, no
 *    throttle, regardless of the auto-update setting.
 *  - **Outdated** — the browser works; an update is an optimization. Camoufox
 *    ships fingerprint fixes as anti-bot vendors adapt, so staying current is
 *    the whole point of the engine — but a ~600 MB download must not happen on
 *    every scrape. Checked at most once per interval, and the check itself is
 *    one GitHub API call, throttled so unauthenticated rate limits are not hit.
 *
 * A failed update is never fatal when a working browser is already installed:
 * scraping with a slightly older build beats not scraping at all.
 */
export async function ensureCamoufox(
  log: (msg: string) => void = () => {},
): Promise<CamoufoxStatus> {
  // Concurrent scrapes must not race two 600 MB downloads into one directory.
  if (ensuring) return ensuring;

  ensuring = (async (): Promise<CamoufoxStatus> => {
    let pkg: PkgManModule;
    try {
      // Not re-exported from the package root; this is the only programmatic
      // route to the installer (the documented one is the `camoufox` CLI).
      pkg = (await import("camoufox-js/dist/pkgman.js")) as unknown as PkgManModule;
    } catch (e) {
      return { installed: null, action: "unavailable", error: (e as Error).message };
    }

    let installed: string | null = null;
    try {
      installed = pkg.installedVerStr();
    } catch {
      installed = null; // not installed yet
    }

    if (!installed) {
      log("camoufox: not installed — downloading (~600MB, first run only)");
      const fetcher = new pkg.CamoufoxFetcher();
      await fetcher.install();
      const now = pkg.installedVerStr();
      writeStamp();
      log(`camoufox: installed ${now}`);
      return { installed: now, latest: now, action: "installed" };
    }

    if (!updatesEnabled()) return { installed, action: "skipped" };
    if (Date.now() - readStamp() < updateIntervalMs()) {
      return { installed, action: "none" };
    }

    try {
      const fetcher = new pkg.CamoufoxFetcher();
      await fetcher.init(); // one GitHub API call
      const latest = fetcher.verstr;
      writeStamp(); // record the check even when already current

      if (latest === installed) {
        log(`camoufox: up to date (${installed})`);
        return { installed, latest, action: "none" };
      }

      log(`camoufox: updating ${installed} -> ${latest}`);
      await fetcher.install();
      return { installed: pkg.installedVerStr(), latest, action: "updated" };
    } catch (e) {
      // Rate limit, offline, GitHub down — keep the working browser.
      log(`camoufox: update check failed (${(e as Error).message}); keeping ${installed}`);
      return { installed, action: "none", error: (e as Error).message };
    }
  })();

  try {
    return await ensuring;
  } finally {
    ensuring = null;
  }
}

// ---------------------------------------------------------------------------
// WebGL sampling probe
// ---------------------------------------------------------------------------

/**
 * Camoufox picks a realistic WebGL vendor/renderer pair by querying a bundled
 * SQLite database through better-sqlite3 — a native module distributed as a
 * prebuilt binary. When that prebuilt does not match the host, loading it
 * SEGFAULTS, taking the whole Node process with it.
 *
 * A segfault cannot be caught: there is no exception to try/catch, no
 * unhandledRejection, not even an exit handler. So "attempt it and fall back"
 * is impossible in-process — the fallback code would never run.
 *
 * Hence a probe in a CHILD process. If the child dies, the parent survives to
 * learn that WebGL sampling is unavailable here and launches with `block_webgl`
 * instead. That is a real (small) loss of fingerprint fidelity, so it is logged
 * rather than hidden — but a slightly weaker fingerprint beats a dead process.
 *
 * Run once per process; the result is cached.
 */
let webglProbe: Promise<boolean> | null = null;

function targetOsName(): "mac" | "win" | "lin" {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return "win";
  return "lin";
}

export async function webglSamplingWorks(): Promise<boolean> {
  if (!webglProbe) {
    webglProbe = (async () => {
      const { execFile } = await import("node:child_process");
      const script =
        `const { sampleWebGL } = await import("camoufox-js/dist/webgl/sample.js");` +
        `await sampleWebGL(${JSON.stringify(targetOsName())});`;
      return await new Promise<boolean>((resolve) => {
        const child = execFile(
          process.execPath,
          ["--input-type=module", "-e", script],
          { cwd: process.cwd(), timeout: 20_000 },
          (err) => resolve(!err),
        );
        child.on("error", () => resolve(false));
      });
    })();
  }
  return webglProbe;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browserPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getBrowser(opts: ScrapeOptions, log: (m: string) => void): Promise<any> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const camoufox = await loadCamoufox();
      if (!camoufox) throw new Error("camoufox-js is not installed");
      await ensureCamoufox(log);

      const { firefox } = await import("playwright-core");
      const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

      const webglOk = await webglSamplingWorks();
      if (!webglOk) {
        log(
          "camoufox: WebGL sampling unavailable (better-sqlite3 prebuilt cannot " +
            "load here) — launching with block_webgl. Fingerprint is slightly " +
            "weaker; fix by making better-sqlite3 loadable on this machine.",
        );
      }

      return firefox.launch({
        ...(await camoufox.launchOptions({
          headless: true,
          // Only when sampling is impossible: blocking WebGL is itself a small
          // signal, so it is never the default.
          ...(webglOk ? {} : { block_webgl: true, i_know_what_im_doing: true }),
          // Humanized cursor movement and a coherent geo/locale/timezone story
          // are what make the session look like a person rather than a client
          // that merely renders JavaScript.
          humanize: true,
          locale: opts.headers?.["accept-language"]?.split(",")[0] ?? "id-ID",
          ...(proxy ? { proxy } : {}),
        })),
      });
    })().catch((e) => {
      browserPromise = null; // a failed launch must not poison later attempts
      throw e;
    });
  }
  return browserPromise;
}

/** Releases the shared Camoufox browser. See closeBrowser() in playwright.ts
 * for why a library must make this explicit. */
export async function closeCamoufox(): Promise<void> {
  const pending = browserPromise;
  if (!pending) return;
  browserPromise = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ((await pending) as any).close();
  } catch {
    // Already gone.
  }
}

export const camoufoxEngine: FetchEngine = {
  name: "camoufox",

  features: {
    javascript: true,
    stealth: true,
    screenshot: true,
    waitFor: true,
    cookies: true,
    location: true,
  },

  // Below playwright (50): it can do strictly more, but pays a heavier launch
  // and a fingerprint-generation step for it. Capability scoring puts it first
  // the moment `stealth` is actually required — which is exactly when a 403 or
  // an anti-bot wall triggers a re-plan — and leaves it last otherwise.
  quality: 40,

  maxReasonableTime(opts: ScrapeOptions): number {
    // Fingerprint generation plus a Firefox launch is slower than Chromium's,
    // and hedging against it too early would waste the launch we just paid for.
    return opts.timeoutMs ?? 75_000;
  },

  async fetch(
    url: string,
    opts: ScrapeOptions,
    signal?: AbortSignal,
  ): Promise<RawResult> {
    signal?.throwIfAborted();
    const log = (m: string) => process.env.DRAZTA_DEBUG && console.error(`[camoufox] ${m}`);

    const browser = await getBrowser(opts, log);
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      // Camoufox pins the window to its spoofed size; forcing a Playwright
      // viewport fights that and leaks the real dimensions.
      viewport: null,
    });

    const onAbort = () => void context.close().catch(() => {});
    signal?.addEventListener("abort", onAbort, { once: true });

    const page = await context.newPage();
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: opts.timeoutMs ?? 60_000,
      });
      await page.waitForTimeout(opts.waitForMs ?? 1500);
      signal?.throwIfAborted();
      return {
        rawHtml: await page.content(),
        statusCode: response?.status(),
        contentType: response?.headers()?.["content-type"],
        resolvedUrl: page.url(),
      };
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await context.close().catch(() => {});
    }
  },
};

/** True when camoufox-js resolves. Used by tests and diagnostics. */
export function camoufoxInstalled(): boolean | null {
  return available;
}
