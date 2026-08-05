<script setup lang="ts">
/**
 * How to read a result. Shown before the first run, where an empty screen
 * would otherwise say nothing — the stamp system is the thing worth teaching,
 * so it is what fills the space.
 */
const LEVELS = [
  {
    source: "json-ld",
    says: "The page published this as structured data. The strongest claim there is.",
  },
  {
    source: "readability",
    says: "Not stated anywhere — recovered from the DOM by rule. Deterministic, but ours.",
  },
  { source: "llm", says: "A model chose this. Worth checking against the source." },
  { source: "none", says: "No layer produced a value. The field is empty, not guessed." },
];
</script>

<template>
  <DzPanel label="How to read a result" soft>
    <p class="mb-4 max-w-2xl text-[15px] leading-relaxed text-ink-2">
      Every value carries a stamp naming where it came from, and colour on this page means only
      that — nothing is tinted for decoration.
    </p>
    <dl class="divide-y divide-rule-soft border-y border-rule-soft">
      <div
        v-for="level in LEVELS"
        :key="level.source"
        class="grid grid-cols-[6.5rem_1fr] items-baseline gap-x-4 py-2.5"
      >
        <dt><DzStamp :source="level.source" /></dt>
        <dd class="text-[13px] leading-relaxed text-ink-2">{{ level.says }}</dd>
      </div>
    </dl>
  </DzPanel>
</template>
