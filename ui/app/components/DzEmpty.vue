<script setup lang="ts">
/**
 * What a page says before it has been asked anything. An empty screen is a
 * chance to explain what the result will mean, so the first run is readable.
 */
defineProps<{ label: string; rows: { term: string; says: string }[] }>();
</script>

<template>
  <DzPanel :label="label" soft>
    <dl class="divide-y divide-rule-soft border-y border-rule-soft">
      <div
        v-for="row in rows"
        :key="row.term"
        class="grid grid-cols-[7rem_1fr] items-baseline gap-x-4 py-2.5 sm:grid-cols-[9rem_1fr]"
      >
        <dt class="font-mono text-xs text-ink">{{ row.term }}</dt>
        <dd class="text-[13px] leading-relaxed text-ink-2">{{ row.says }}</dd>
      </div>
    </dl>
  </DzPanel>
</template>
