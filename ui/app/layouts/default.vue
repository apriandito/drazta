<script setup lang="ts">
const { theme, toggle } = useTheme();

/**
 * The rail reuses the panel motif: a bound item is the active one. Solid ink
 * head-line = you are here, hairline = you are not.
 */
const NAV = [
  { to: "/", label: "Scrape", gloss: "page → markdown" },
  { to: "/extract", label: "Extract", gloss: "article & product" },
  { to: "/tables", label: "Tables", gloss: "tables → typed rows" },
  { to: "/discover", label: "Discover", gloss: "map & crawl" },
  { to: "/agent", label: "Agent", gloss: "task → file" },
];
</script>

<template>
  <div class="min-h-dvh bg-ground lg:flex">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:text-surface"
    >
      Skip to content
    </a>

    <!-- Rail -->
    <header
      class="shrink-0 border-b border-rule bg-surface lg:sticky lg:top-0 lg:h-dvh lg:w-56 lg:border-r lg:border-b-0"
    >
      <div class="flex h-full flex-col gap-6 px-5 py-5 lg:px-6">
        <div class="flex items-start justify-between gap-4">
          <NuxtLink to="/" class="block">
            <span class="display block text-[22px] leading-none text-ink">DRAZTA</span>
            <span class="mt-1.5 flex items-baseline gap-1.5">
              <span
                class="text-[13px] leading-none text-ink-2"
                style="font-family: 'Kohinoor Devanagari', 'Noto Sans Devanagari', 'Devanagari Sangam MN', serif"
                lang="sa"
                >द्रष्टृ</span
              >
              <span class="font-mono text-[10px] tracking-wider text-ink-3 lowercase">the seer</span>
            </span>
          </NuxtLink>

          <button
            type="button"
            class="border border-rule px-2 py-1 font-mono text-[10px] tracking-wider text-ink-2 uppercase transition-colors hover:border-ink hover:text-ink lg:hidden"
            @click="toggle"
          >
            {{ theme === "dark" ? "Light" : "Dark" }}
          </button>
        </div>

        <nav class="-mx-1 flex gap-1 overflow-x-auto lg:mx-0 lg:flex-1 lg:flex-col lg:gap-0 lg:overflow-visible">
          <NuxtLink
            v-for="item in NAV"
            :key="item.to"
            :to="item.to"
            class="group shrink-0 px-1 pt-2 pb-2.5 transition-colors lg:shrink lg:px-0"
            :active-class="item.to === '/' ? '' : 'is-here'"
            exact-active-class="is-here"
          >
            <span class="nav-rule mb-2 block h-0.5 w-full bg-rule transition-colors" />
            <span class="nav-label block font-mono text-xs tracking-wider text-ink-2 uppercase">
              {{ item.label }}
            </span>
            <span class="mt-0.5 hidden font-mono text-[10px] text-ink-3 lg:block">
              {{ item.gloss }}
            </span>
          </NuxtLink>
        </nav>

        <button
          type="button"
          class="hidden w-fit border border-rule px-2.5 py-1.5 font-mono text-[10px] tracking-wider text-ink-2 uppercase transition-colors hover:border-ink hover:text-ink lg:block"
          @click="toggle"
        >
          {{ theme === "dark" ? "Light" : "Dark" }}
        </button>
      </div>
    </header>

    <main id="main" class="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
      <div class="mx-auto max-w-5xl">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
/* Only the exact-active route is bound. */
.is-here .nav-rule {
  background: var(--ink);
}
.is-here .nav-label {
  color: var(--ink);
}
</style>
