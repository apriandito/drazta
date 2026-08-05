<script setup lang="ts">
import type { Failure } from "~/types/api";

/**
 * A failure states what happened and what to do next. `fatal` is the library's
 * own distinction and the most useful thing on screen: a fatal error means no
 * engine will ever succeed here, so retrying with a browser is wasted effort.
 */
const props = defineProps<{ failure: Failure }>();

const ADVICE: Record<string, string> = {
  BadInput: "Fix the input above and run it again.",
  UnsupportedContentError: "This URL serves a binary body, not a page. Drazta parses HTML only.",
  Unreachable: "The console could not reach its own server. Is the dev server still running?",
};

const advice = computed(() => {
  if (ADVICE[props.failure.kind]) return ADVICE[props.failure.kind];
  if (props.failure.fatal) {
    return "Fatal: the host itself is unreachable. No engine can get past this, so a browser retry will not help.";
  }
  return "Not fatal — the page rejected this attempt. Try turning on “Needs a browser”.";
});
</script>

<template>
  <div class="border-l-2 border-degraded bg-degraded-bg px-4 py-3">
    <div class="flex flex-wrap items-center gap-2.5">
      <DzStamp source="degraded" :title="failure.fatal ? 'Fatal — stop here' : 'Recoverable'" />
      <span class="font-mono text-[11px] tracking-wider text-degraded uppercase">
        {{ failure.kind }}{{ failure.fatal ? " · fatal" : "" }}
      </span>
      <span class="font-mono text-[11px] text-degraded/70">{{ failure.ms }} ms</span>
    </div>
    <p class="mt-2 font-mono text-[13px] leading-relaxed break-words text-ink">
      {{ failure.message }}
    </p>
    <p class="mt-1.5 text-[13px] leading-relaxed text-ink-2">{{ advice }}</p>
  </div>
</template>
