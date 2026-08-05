/* Camoufox routing checks: does the registry send stealth work to the stealth
   engine, and can a caller still pick an engine by name? No network. */
import assert from "node:assert";
import { buildFallbackList, engines } from "../src/engines/registry.js";
import { camoufoxEngine } from "../src/engines/camoufox.js";
import { playwrightEngine } from "../src/engines/playwright.js";
import { fetchEngine } from "../src/engines/fetch.js";
import { resolveHeadless } from "../src/engines/headless.js";

let passed = 0;
const ok = (n: string) => (passed++, console.log(`  ✓ ${n}`));
const names = (opts: Parameters<typeof buildFallbackList>[1], extra: string[] = []) =>
  buildFallbackList("https://x.test/", opts, extra as never[]).map((c) => c.engine.name);

function testRegistered() {
  console.log("registry:");
  assert.ok(engines.includes(camoufoxEngine), "camoufox not registered");
  assert.equal(camoufoxEngine.name, "camoufox");
  ok("camoufox is in the registry");

  // Only one engine may claim real stealth, or a stealth re-plan can pick the
  // one that cannot actually get through.
  const stealthy = engines.filter((e) => e.features.stealth).map((e) => e.name);
  assert.deepEqual(stealthy, ["camoufox"], `stealth claimed by: ${stealthy.join(", ")}`);
  ok("camoufox is the only engine claiming stealth");
}

function testOrdering() {
  console.log("ordering:");

  // Ordinary page: camoufox must NOT jump the queue. It is the heaviest engine
  // (a ~600MB Firefox plus fingerprint generation) and buys nothing here.
  assert.deepEqual(names({}), ["fetch", "playwright", "camoufox"]);
  ok("plain scrape: fetch → playwright → camoufox (heaviest last)");

  // JS needed, stealth not: Chromium is the cheaper way to run JavaScript.
  assert.deepEqual(names({ requiresJs: true }), ["playwright", "camoufox"]);
  ok("requiresJs: playwright leads, camoufox is the backup");

  // Stealth needed: everything without it falls below the threshold.
  assert.deepEqual(names({ features: ["stealth"] }), ["camoufox"]);
  ok("stealth required: only camoufox qualifies");

  // What a re-plan after a 403 actually asks for.
  const replan = names({}, ["stealth", "javascript"]);
  assert.equal(replan[0], "camoufox", `re-plan chose ${replan[0]}`);
  assert.ok(replan.includes("playwright"), "playwright should remain as fallback");
  ok("a stealth+javascript re-plan puts camoufox first, playwright behind it");
}

function testExplicitChoice() {
  console.log("explicit choice:");
  for (const engine of ["camoufox", "playwright", "fetch"]) {
    const list = buildFallbackList("https://x.test/", { engine }, []);
    assert.deepEqual(list.map((c) => c.engine.name), [engine]);
  }
  ok("engine: 'camoufox' | 'playwright' | 'fetch' pins the choice exactly");

  // Pinning overrides capability scoring — asking for fetch on a JS page gets
  // fetch, not a silent upgrade to a browser.
  const pinned = buildFallbackList("https://x.test/", { engine: "fetch", requiresJs: true }, []);
  assert.deepEqual(pinned.map((c) => c.engine.name), ["fetch"]);
  ok("a pinned engine is never overridden by inferred capabilities");

  assert.throws(() => buildFallbackList("https://x.test/", { engine: "nope" }, []), /Unknown engine/);
  ok("an unknown engine name fails loudly");
}

function testShape() {
  console.log("engine shape:");
  // Heavier than Chromium, so it must not outrank it on quality alone.
  assert.ok(
    camoufoxEngine.quality < playwrightEngine.quality,
    "camoufox quality should sit below playwright",
  );
  assert.ok(playwrightEngine.quality < fetchEngine.quality);
  ok("quality ordering: fetch > playwright > camoufox");

  const mrt = camoufoxEngine.maxReasonableTime({});
  assert.ok(
    mrt > playwrightEngine.maxReasonableTime({}),
    "camoufox needs a longer patience budget than plain Chromium",
  );
  ok(`maxReasonableTime honours the slower launch (${mrt}ms)`);

  assert.equal(camoufoxEngine.maxReasonableTime({ timeoutMs: 9000 }), 9000);
  ok("an explicit timeout wins over the default");
}

function testHeadless() {
  console.log("headless option:");
  assert.equal(resolveHeadless({}), true);
  ok("headless by default");

  assert.equal(resolveHeadless({ headless: false }), false);
  ok("headless:false opens a visible window");

  const prev = process.env.DRAZTA_HEADLESS;
  try {
    process.env.DRAZTA_HEADLESS = "0";
    assert.equal(resolveHeadless({}), false, "env should switch the default");
    // A per-request value must still win, or a debugging env var would
    // silently change behaviour for callers that asked for headless.
    assert.equal(resolveHeadless({ headless: true }), true);
  } finally {
    if (prev === undefined) delete process.env.DRAZTA_HEADLESS;
    else process.env.DRAZTA_HEADLESS = prev;
  }
  ok("DRAZTA_HEADLESS=0 flips the default, per-request still wins");
}

function main() {
  testRegistered();
  testHeadless();
  testOrdering();
  testExplicitChoice();
  testShape();
  console.log(`\nAll ${passed} camoufox routing checks passed ✅`);
}

main();
