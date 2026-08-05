<script setup lang="ts">
/**
 * The provenance stamp — the one place colour is allowed on this page.
 *
 * Four levels of confidence, and the fill carries the distinction:
 *   filled teal    the page stated it outright (JSON-LD, meta, sitemap)
 *   outlined teal  we derived it deterministically (readability, link harvest)
 *   violet         a model inferred it
 *   amber          treat it with suspicion (degraded)
 *   grey           nothing found
 */
const props = defineProps<{ source?: string | null; title?: string }>();

const LEVELS: Record<string, { label: string; level: "stated" | "derived" | "inferred" | "suspect" | "absent" }> = {
  "json-ld": { label: "json-ld", level: "stated" },
  meta: { label: "meta", level: "stated" },
  sitemap: { label: "sitemap", level: "stated" },
  readability: { label: "readability", level: "derived" },
  links: { label: "links", level: "derived" },
  llm: { label: "llm", level: "inferred" },
  degraded: { label: "degraded", level: "suspect" },
  none: { label: "not found", level: "absent" },
};

const entry = computed(() => LEVELS[props.source ?? "none"] ?? { label: props.source ?? "none", level: "absent" as const });

const CLASSES: Record<string, string> = {
  stated: "bg-seen-bg text-seen border-transparent",
  derived: "bg-transparent text-seen border-seen/45",
  inferred: "bg-inferred-bg text-inferred border-transparent",
  suspect: "bg-degraded-bg text-degraded border-transparent",
  absent: "bg-absent-bg text-absent border-transparent",
};

const EXPLANATION: Record<string, string> = {
  stated: "The page stated this itself",
  derived: "Derived deterministically from the page",
  inferred: "Inferred by a language model",
  suspect: "Returned anyway — treat with suspicion",
  absent: "No source produced a value",
};
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center border px-1.5 py-px font-mono text-[10px] font-medium tracking-wider uppercase"
    :class="CLASSES[entry.level]"
    :title="title ?? EXPLANATION[entry.level]"
  >
    {{ entry.label }}
  </span>
</template>
