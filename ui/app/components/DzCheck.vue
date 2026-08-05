<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
defineProps<{ label: string; hint?: string }>();
</script>

<template>
  <label class="group flex cursor-pointer items-start gap-2.5 py-0.5">
    <input
      v-model="model"
      type="checkbox"
      class="mt-px size-3.5 shrink-0 appearance-none border border-rule bg-surface transition-colors checked:border-ink checked:bg-ink group-hover:border-ink-3"
    />
    <span class="flex flex-col gap-0.5">
      <span class="font-mono text-xs text-ink">{{ label }}</span>
      <span v-if="hint" class="font-mono text-[11px] leading-snug text-ink-3">{{ hint }}</span>
    </span>
  </label>
</template>
