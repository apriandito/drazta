<script setup lang="ts">
/**
 * Chrome stays achromatic. Hue on this page is a claim about provenance, so a
 * button never gets to use it — it earns emphasis from ink and weight instead.
 */
withDefaults(
  defineProps<{
    pending?: boolean;
    disabled?: boolean;
    variant?: "solid" | "quiet";
    type?: "button" | "submit";
  }>(),
  { pending: false, disabled: false, variant: "solid", type: "button" },
);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || pending"
    class="inline-flex items-center justify-center gap-2 px-4 py-2 font-mono text-xs font-medium tracking-wider uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-45"
    :class="
      variant === 'solid'
        ? 'bg-ink text-surface hover:bg-ink-2'
        : 'border border-rule text-ink hover:border-ink hover:bg-sunk'
    "
  >
    <span
      v-if="pending"
      class="size-2.5 shrink-0 animate-pulse rounded-full"
      :class="variant === 'solid' ? 'bg-surface' : 'bg-ink'"
      aria-hidden="true"
    />
    <slot />
  </button>
</template>
