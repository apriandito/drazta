<script setup lang="ts">
defineProps<{ title: string; lede: string }>();
</script>

<template>
  <header class="mb-10">
    <h1 class="display text-3xl leading-tight text-ink sm:text-4xl">{{ title }}</h1>
    <p class="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">{{ lede }}</p>
    <slot />
  </header>
</template>
