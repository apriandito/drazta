import type { Envelope, Failure } from "~/types/api";

/**
 * One request at a time, per page. Holds the last good result and the last
 * failure separately so a failed retry does not silently wipe the result the
 * user is still reading.
 */
export function useRun<T extends object>(path: string) {
  const pending = ref(false);
  const data = ref<({ ms: number } & T) | null>(null) as Ref<({ ms: number } & T) | null>;
  const failure = ref<Failure | null>(null);

  async function go(body: Record<string, unknown>) {
    pending.value = true;
    failure.value = null;
    try {
      const res = await $fetch<Envelope<T>>(path, { method: "POST", body });
      if (res.ok) {
        const { ok: _ok, ...rest } = res;
        data.value = rest as { ms: number } & T;
      } else {
        failure.value = res;
      }
    } catch (err) {
      // A transport-level failure — the route never answered at all.
      failure.value = {
        ok: false,
        ms: 0,
        kind: "Unreachable",
        fatal: false,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      pending.value = false;
    }
  }

  function reset() {
    data.value = null;
    failure.value = null;
  }

  return { pending, data, failure, go, reset };
}
