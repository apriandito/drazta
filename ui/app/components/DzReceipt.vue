<script setup lang="ts">
import type { DocumentMetadata } from "~/types/api";

/**
 * The receipt: what the seer actually did to get this. Which engine won the
 * race, what the server answered, how much text survived parsing, how long it
 * took. A `degraded` flag is never folded away — it takes the whole width.
 */
const props = defineProps<{ metadata?: DocumentMetadata | null; ms?: number | null }>();

const bytes = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const stats = computed(() => {
  const m = props.metadata;
  const out: { label: string; value: string }[] = [];
  if (m?.engine) out.push({ label: "engine", value: m.engine });
  if (m?.statusCode) out.push({ label: "status", value: String(m.statusCode) });
  if (typeof props.ms === "number") out.push({ label: "took", value: `${props.ms} ms` });
  if (typeof m?.textLength === "number") {
    out.push({ label: "text", value: `${bytes(m.textLength)} chars` });
  }
  if (m?.mainContent !== undefined) {
    out.push({ label: "scope", value: m.mainContent ? "main content" : "full page" });
  }
  return out;
});
</script>

<template>
  <div>
    <dl class="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 font-mono text-xs">
      <div v-for="stat in stats" :key="stat.label" class="flex items-baseline gap-1.5">
        <dt class="text-ink-3">{{ stat.label }}</dt>
        <dd class="text-ink">{{ stat.value }}</dd>
      </div>
    </dl>

    <p
      v-if="metadata?.rewrittenUrl"
      class="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-2"
    >
      <DzStamp source="meta" title="The URL was rewritten before fetching" />
      <span>fetched instead:</span>
      <span class="break-all text-ink">{{ metadata.rewrittenUrl }}</span>
    </p>

    <p
      v-if="metadata?.degraded"
      class="mt-3 flex items-start gap-2.5 border-l-2 border-degraded bg-degraded-bg px-3 py-2 text-xs text-degraded"
    >
      <DzStamp source="degraded" />
      <span class="font-mono leading-relaxed">
        Every engine rejected this page. The text below is the best partial result — {{ metadata.degraded }}
      </span>
    </p>
  </div>
</template>
