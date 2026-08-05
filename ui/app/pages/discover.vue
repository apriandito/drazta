<script setup lang="ts">
import type { CrawledPage, MapEntry } from "~/types/api";

useHead({ title: "Discover · Drazta" });

const mode = ref<"map" | "crawl">("map");

const mapForm = reactive({ url: "", limit: 100, prefix: "", includeSeedLinks: true });
const crawlForm = reactive({
  url: "",
  prefix: "",
  limit: 20,
  maxDepth: 2,
  concurrency: 5,
  onlyMainContent: true,
});

const map = useRun<{
  entries: MapEntry[];
  total: number;
  fromSitemap: number;
  fromLinks: number;
}>("/api/map");

const crawled = useRun<{
  pages: CrawledPage[];
  errors: { url: string; error: string }[];
  degradedCount: number;
}>("/api/crawl");

const mapFigures = computed(() => {
  const d = map.data.value;
  if (!d) return [];
  return [
    { value: d.total.toLocaleString("en-US"), label: "URLs found" },
    { value: d.fromSitemap.toLocaleString("en-US"), label: "from sitemap" },
    { value: d.fromLinks.toLocaleString("en-US"), label: "from links" },
    d.ms >= 1000
      ? { value: (d.ms / 1000).toFixed(1), label: "seconds" }
      : { value: String(d.ms), label: "milliseconds" },
  ];
});

const crawlFigures = computed(() => {
  const d = crawled.data.value;
  if (!d) return [];
  return [
    { value: d.pages.length.toLocaleString("en-US"), label: "pages scraped" },
    { value: d.errors.length.toLocaleString("en-US"), label: "did not make it" },
    d.ms >= 1000
      ? { value: (d.ms / 1000).toFixed(1), label: "seconds" }
      : { value: String(d.ms), label: "milliseconds" },
  ];
});

function saveUrls() {
  const list = map.data.value?.entries ?? [];
  downloadText(
    `${slugFromUrl(mapForm.url)}-urls.txt`,
    list.map((e) => e.url).join("\n"),
    "text/plain;charset=utf-8",
  );
}
</script>

<template>
  <div>
    <DzPageHead
      title="Find the pages first"
      lede="Two ways to learn what a site holds. Map reads the site's own sitemap — what it declares about itself — and falls back to harvesting homepage links. Crawl walks the links breadth-first, deduped by canonical key so ?utm_source variants never count twice."
    />

    <div class="mb-8 flex gap-1.5">
      <button
        v-for="tab in [
          { value: 'map', label: 'Map', gloss: 'sitemap → URL list' },
          { value: 'crawl', label: 'Crawl', gloss: 'follow links, scrape each' },
        ]"
        :key="tab.value"
        type="button"
        class="flex flex-col items-start border px-3.5 py-2 transition-colors"
        :class="
          mode === tab.value
            ? 'border-ink bg-ink text-surface'
            : 'border-rule text-ink-2 hover:border-ink-3 hover:text-ink'
        "
        :aria-pressed="mode === tab.value"
        @click="mode = tab.value as 'map' | 'crawl'"
      >
        <span class="font-mono text-[11px] tracking-wider uppercase">{{ tab.label }}</span>
        <span class="font-mono text-[10px] opacity-70">{{ tab.gloss }}</span>
      </button>
    </div>

    <!-- ================= map ================= -->
    <template v-if="mode === 'map'">
      <DzPanel label="Request">
        <form class="flex flex-col gap-5" @submit.prevent="map.go({ ...mapForm })">
          <div class="flex flex-col gap-3 sm:flex-row">
            <input
              v-model="mapForm.url"
              class="input"
              type="text"
              inputmode="url"
              placeholder="https://www.kompas.com"
              aria-label="Site to map"
              required
            />
            <DzButton type="submit" :pending="map.pending.value" class="sm:w-40">
              {{ map.pending.value ? "Mapping" : "Map site" }}
            </DzButton>
          </div>

          <div class="grid gap-5 sm:grid-cols-2">
            <DzField label="Limit" hint="Cap on returned URLs.">
              <input v-model.number="mapForm.limit" class="input" type="number" min="1" max="2000" />
            </DzField>
            <DzField label="Path prefix" hint="Optional. Keep only URLs under this path.">
              <input
                v-model="mapForm.prefix"
                class="input"
                type="text"
                placeholder="https://www.kompas.com/tren"
              />
            </DzField>
          </div>

          <DzCheck
            v-model="mapForm.includeSeedLinks"
            label="Also harvest homepage links"
            hint="Off means sitemap entries only — everything returned is then site-declared."
          />
        </form>
      </DzPanel>

      <div v-if="!map.data.value && !map.failure.value && !map.pending.value" class="mt-10">
        <DzEmpty
          label="Where the URLs come from"
          :rows="[
            {
              term: 'robots.txt',
              says: 'Read for Sitemap: directives — the site pointing at its own index.',
            },
            {
              term: 'sitemap.xml',
              says: 'Parsed directly, following one level of sitemap index. These entries are site-declared.',
            },
            {
              term: 'homepage links',
              says: 'The fallback when there is no sitemap. Harvested by us, so they carry a different stamp.',
            },
            {
              term: 'dedup',
              says: 'By canonical key: www, :443, index.html and ?utm_* variants collapse to one, while ?page=2 stays distinct.',
            },
          ]"
        />
      </div>

      <div v-if="map.failure.value" class="mt-10">
        <DzPanel label="Failed"><DzFailure :failure="map.failure.value" /></DzPanel>
      </div>

      <div v-if="map.data.value" class="mt-10 flex flex-col gap-10">
        <DzPanel label="Receipt">
          <DzFigures :figures="mapFigures" />
          <p class="mt-5 text-[13px] leading-relaxed text-ink-2">
            Sitemap entries are what the site declares about itself. Link entries were harvested
            from the homepage — the same page, read by us.
          </p>
        </DzPanel>

        <DzPanel
          v-if="map.data.value.total"
          label="URLs"
          :meta="`${map.data.value.total.toLocaleString('en-US')} total`"
        >
          <div class="mb-3 flex justify-end">
            <DzButton variant="quiet" @click="saveUrls">Save as .txt</DzButton>
          </div>
          <ul
            class="max-h-[32rem] divide-y divide-rule-soft overflow-y-auto border border-rule-soft bg-surface"
          >
            <li
              v-for="entry in map.data.value.entries"
              :key="entry.url"
              class="flex items-center gap-3 px-3 py-1.5"
            >
              <DzStamp :source="entry.source" />
              <a
                :href="entry.url"
                target="_blank"
                rel="noopener noreferrer nofollow"
                class="min-w-0 font-mono text-xs break-all text-ink-2 hover:text-ink hover:underline"
                >{{ entry.url }}</a
              >
            </li>
          </ul>
        </DzPanel>

        <DzPanel v-else label="Nothing found" soft>
          <p class="text-[15px] text-ink-2">
            No sitemap and no usable homepage links. Try Crawl instead — it follows links from a
            page you name rather than waiting for the site to declare them.
          </p>
        </DzPanel>
      </div>
    </template>

    <!-- ================= crawl ================= -->
    <template v-else>
      <DzPanel label="Request">
        <form class="flex flex-col gap-5" @submit.prevent="crawled.go({ ...crawlForm })">
          <div class="flex flex-col gap-3 sm:flex-row">
            <input
              v-model="crawlForm.url"
              class="input"
              type="text"
              inputmode="url"
              placeholder="https://example.com/blog"
              aria-label="Seed URL to crawl from"
              required
            />
            <DzButton type="submit" :pending="crawled.pending.value" class="sm:w-40">
              {{ crawled.pending.value ? "Crawling" : "Start crawl" }}
            </DzButton>
          </div>

          <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <DzField label="Pages" hint="Hard cap.">
              <input v-model.number="crawlForm.limit" class="input" type="number" min="1" max="200" />
            </DzField>
            <DzField label="Depth" hint="Seed is 0.">
              <input v-model.number="crawlForm.maxDepth" class="input" type="number" min="0" max="6" />
            </DzField>
            <DzField label="Concurrency" hint="Parallel scrapes.">
              <input
                v-model.number="crawlForm.concurrency"
                class="input"
                type="number"
                min="1"
                max="12"
              />
            </DzField>
            <DzField label="Path prefix" hint="Optional.">
              <input v-model="crawlForm.prefix" class="input" type="text" placeholder="/blog" />
            </DzField>
          </div>

          <DzCheck v-model="crawlForm.onlyMainContent" label="Only main content on every page" />
        </form>
      </DzPanel>

      <div v-if="crawled.failure.value" class="mt-10">
        <DzPanel label="Failed"><DzFailure :failure="crawled.failure.value" /></DzPanel>
      </div>

      <div v-if="crawled.data.value" class="mt-10 flex flex-col gap-10">
        <DzPanel label="Receipt">
          <DzFigures :figures="crawlFigures" />
          <p
            v-if="crawled.data.value.degradedCount"
            class="mt-5 flex flex-wrap items-center gap-2.5 font-mono text-[11px] text-ink-2"
          >
            <DzStamp source="degraded" />
            <span>
              {{ crawled.data.value.degradedCount }} of these pages came back degraded — every
              engine rejected them and the best partial result was kept.
            </span>
          </p>
        </DzPanel>

        <DzPanel
          v-if="crawled.data.value.pages.length"
          label="Pages"
          :meta="`${crawled.data.value.pages.length} scraped`"
        >
          <div class="overflow-x-auto border border-rule-soft bg-surface">
            <table class="w-full border-collapse font-mono text-xs">
              <thead>
                <tr class="border-b border-rule">
                  <th scope="col" class="px-3 py-2 text-left text-ink">title</th>
                  <th scope="col" class="px-3 py-2 text-left text-ink">engine</th>
                  <th scope="col" class="px-3 py-2 text-right text-ink">status</th>
                  <th scope="col" class="px-3 py-2 text-right text-ink">text</th>
                  <th scope="col" class="px-3 py-2 text-left text-ink">date</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="page in crawled.data.value.pages"
                  :key="page.url"
                  class="border-b border-rule-soft last:border-0 hover:bg-sunk"
                >
                  <td class="max-w-md px-3 py-2 align-top">
                    <a
                      :href="page.url"
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      class="block truncate text-ink hover:underline"
                      :title="page.url"
                      >{{ page.title || page.url }}</a
                    >
                    <DzStamp v-if="page.degraded" source="degraded" class="mt-1" />
                  </td>
                  <td class="px-3 py-2 align-top text-ink-2">{{ page.engine ?? "—" }}</td>
                  <td class="px-3 py-2 text-right align-top tabular-nums text-ink-2">
                    {{ page.statusCode ?? "—" }}
                  </td>
                  <td class="px-3 py-2 text-right align-top tabular-nums text-ink-2">
                    {{ page.textLength?.toLocaleString("en-US") ?? "—" }}
                  </td>
                  <td class="px-3 py-2 align-top text-ink-2">{{ page.publishedDate ?? "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </DzPanel>

        <DzPanel
          v-if="crawled.data.value.errors.length"
          label="Did not make it"
          soft
          :meta="`${crawled.data.value.errors.length} URLs`"
        >
          <ul class="flex flex-col gap-1.5">
            <li
              v-for="err in crawled.data.value.errors"
              :key="err.url"
              class="flex flex-col gap-0.5 border-l-2 border-degraded bg-degraded-bg px-3 py-1.5"
            >
              <span class="font-mono text-[11px] break-all text-ink">{{ err.url }}</span>
              <span class="font-mono text-[11px] text-degraded">{{ err.error }}</span>
            </li>
          </ul>
        </DzPanel>
      </div>
    </template>
  </div>
</template>
