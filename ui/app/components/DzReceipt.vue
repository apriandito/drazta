<script setup lang="ts">
import type { DocumentMetadata } from "~/types/api";

/**
 * The receipt: what the seer actually did to get this.
 *
 * These measurements are the reason to trust — or distrust — a result, so they
 * are set at figure scale rather than caption scale. A page can be 200 OK with
 * 60 KB of HTML and no article; here that shows up as a small number you cannot
 * miss. `degraded` is never folded away.
 */
const props = defineProps<{ metadata?: DocumentMetadata | null; ms?: number | null }>();

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const figures = computed(() => {
  const m = props.metadata;
  const out: { value: string; label: string; mono?: boolean }[] = [];

  if (typeof props.ms === "number") {
    out.push(
      props.ms >= 1000
        ? { value: (props.ms / 1000).toFixed(1), label: "seconds" }
        : { value: String(props.ms), label: "milliseconds" },
    );
  }
  if (m?.statusCode) out.push({ value: String(m.statusCode), label: "status" });
  if (typeof m?.textLength === "number") {
    out.push({ value: compact(m.textLength), label: "chars of text" });
  }
  if (m?.engine) out.push({ value: m.engine, label: "engine that won", mono: true });
  return out;
});

/** Facts that qualify the result without being measurements. */
const notes = computed(() => {
  const m = props.metadata;
  const out: string[] = [];
  if (m?.mainContent !== undefined) {
    out.push(m.mainContent ? "scoped to main content" : "full page — scoping came up thin");
  }
  if (m?.contentType) out.push(m.contentType);
  return out;
});
</script>

<template>
  <div>
    <DzFigures :figures="figures" />

    <p v-if="notes.length" class="mt-5 font-mono text-[11px] text-ink-3">
      {{ notes.join(" · ") }}
    </p>

    <p
      v-if="metadata?.rewrittenUrl"
      class="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-2"
    >
      <DzStamp source="meta" title="The URL was rewritten before fetching" />
      <span>fetched instead:</span>
      <span class="break-all text-ink">{{ metadata.rewrittenUrl }}</span>
    </p>

    <div
      v-if="metadata?.degraded"
      class="mt-5 flex items-start gap-3 border-l-2 border-degraded bg-degraded-bg px-4 py-3"
    >
      <DzStamp source="degraded" />
      <p class="font-mono text-xs leading-relaxed text-degraded">
        Every engine rejected this page. What you are reading is the best partial result —
        {{ metadata.degraded }}
      </p>
    </div>
  </div>
</template>
