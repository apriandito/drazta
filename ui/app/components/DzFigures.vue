<script setup lang="ts">
/**
 * A row of measurements at figure scale.
 *
 * Every result in this console is judged by its numbers, so all of them are set
 * the same way wherever they appear — one visual language for "here is what
 * actually happened", whether the subject is a document, a crawl or an agent run.
 */
defineProps<{
  figures: { value: string | number; label: string; mono?: boolean }[];
}>();
</script>

<template>
  <dl class="flex flex-wrap gap-x-10 gap-y-6">
    <div v-for="figure in figures" :key="figure.label" class="flex flex-col gap-1.5">
      <dd class="readout-figure" :class="figure.mono ? 'lowercase' : ''">{{ figure.value }}</dd>
      <dt class="eyebrow text-ink-3">{{ figure.label }}</dt>
    </div>
  </dl>
</template>
