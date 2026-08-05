<script setup lang="ts">
defineProps<{ label: string; hint?: string; for?: string }>();
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="$props.for" class="eyebrow">{{ label }}</label>
    <slot />
    <p v-if="hint" class="font-mono text-[11px] leading-relaxed text-ink-3">{{ hint }}</p>
  </div>
</template>
