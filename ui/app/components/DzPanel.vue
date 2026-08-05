<script setup lang="ts">
/**
 * A bound block.
 *
 * Devanagari runs a head-line (shirorekha) across the top of a word to bind
 * its letters into one unit. Every panel here is bound the same way: a solid
 * rule across the top with the label hanging beneath it. It is the only
 * ornament in this design, and it comes from the name — draṣṭṛ.
 */
withDefaults(
  defineProps<{
    label: string;
    meta?: string | null;
    /** Soft-bound panels are subordinate — a hairline instead of solid ink. */
    soft?: boolean;
  }>(),
  { meta: null, soft: false },
);
</script>

<template>
  <section :class="soft ? 'bound-soft' : 'bound'">
    <header class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-2.5 pb-4">
      <h2 class="eyebrow" :class="soft ? 'text-ink-3' : 'text-ink'">{{ label }}</h2>
      <p v-if="meta" class="font-mono text-[11px] text-ink-3">{{ meta }}</p>
      <slot name="meta" />
    </header>
    <slot />
  </section>
</template>
