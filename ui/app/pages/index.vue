<script setup lang="ts">
import type { ScrapedDocument } from "~/types/api";

useHead({ title: "Scrape · Drazta" });

const ALL_FORMATS = ["markdown", "metadata", "links", "html", "rawHtml"] as const;

const form = reactive({
  url: "",
  onlyMainContent: true,
  requiresJs: false,
  formats: ["markdown", "metadata"] as string[],
});

const { pending, data, failure, go } = useRun<{ document: ScrapedDocument }>("/api/scrape");

const { data: engineInfo } = await useFetch<{
  engines: { name: string; quality: number; optional: boolean; installed: boolean }[];
}>("/api/engines");

const browserEngine = computed(() =>
  engineInfo.value?.engines.find((e) => e.optional && !e.installed),
);

function toggleFormat(format: string) {
  const at = form.formats.indexOf(format);
  if (at === -1) form.formats.push(format);
  else if (form.formats.length > 1) form.formats.splice(at, 1);
}

const meta = computed(() => data.value?.document.metadata);

/** Metadata worth surfacing above the fold, in the order a reader wants it. */
const HEADLINE_FIELDS = [
  "title",
  "description",
  "author",
  "publishedDate",
  "siteName",
  "section",
  "language",
  "canonical",
] as const;

const headline = computed(() => {
  const m = meta.value;
  if (!m) return [];
  return HEADLINE_FIELDS.filter((k) => m[k]).map((k) => ({ key: k, value: String(m[k]) }));
});
</script>

<template>
  <div>
    <DzPageHead
      title="Scrape a page"
      lede="One URL in, clean markdown out. The receipt under each result names the engine that won the race, what the server answered, and how much text survived parsing — so you can tell a good scrape from a lucky one."
    />

    <DzPanel label="Request">
      <form class="flex flex-col gap-5" @submit.prevent="go({ ...form })">
        <div class="flex flex-col gap-3 sm:flex-row">
          <input
            v-model="form.url"
            class="input"
            type="text"
            inputmode="url"
            placeholder="https://www.cnbcindonesia.com/…"
            aria-label="URL to scrape"
            required
          />
          <DzButton type="submit" :pending="pending" class="sm:w-40">
            {{ pending ? "Scraping" : "Scrape page" }}
          </DzButton>
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <div class="flex flex-col gap-2">
            <span class="eyebrow">Options</span>
            <DzCheck
              v-model="form.onlyMainContent"
              label="Only main content"
              hint="Drop nav, sidebars and footers. Widens back out if the result comes up thin."
            />
            <DzCheck
              v-model="form.requiresJs"
              label="Needs a browser"
              :hint="
                browserEngine
                  ? `Playwright is not installed — run: npx playwright install chromium`
                  : 'Render with Chromium first, for pages that ship an empty shell.'
              "
            />
          </div>

          <DzField label="Formats" hint="What to compute and return. At least one stays on.">
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="format in ALL_FORMATS"
                :key="format"
                type="button"
                class="border px-2.5 py-1 font-mono text-[11px] transition-colors"
                :class="
                  form.formats.includes(format)
                    ? 'border-ink bg-ink text-surface'
                    : 'border-rule text-ink-2 hover:border-ink-3 hover:text-ink'
                "
                :aria-pressed="form.formats.includes(format)"
                @click="toggleFormat(format)"
              >
                {{ format }}
              </button>
            </div>
          </DzField>
        </div>
      </form>
    </DzPanel>

    <div v-if="failure" class="mt-10">
      <DzPanel label="Failed">
        <DzFailure :failure="failure" />
      </DzPanel>
    </div>

    <div v-if="data" class="mt-10 flex flex-col gap-10">
      <DzPanel label="Receipt">
        <DzReceipt :metadata="meta" :ms="data.ms" />
      </DzPanel>

      <DzPanel v-if="headline.length" label="Metadata" soft>
        <dl class="divide-y divide-rule-soft border-y border-rule-soft">
          <div
            v-for="row in headline"
            :key="row.key"
            class="grid grid-cols-[minmax(0,7.5rem)_1fr] gap-x-4 py-2.5"
          >
            <dt class="font-mono text-xs text-ink-2">{{ row.key }}</dt>
            <dd class="min-w-0 font-mono text-[13px] break-words text-ink">{{ row.value }}</dd>
          </div>
        </dl>
      </DzPanel>

      <DzPanel
        v-if="data.document.markdown"
        label="Markdown"
        soft
        :meta="`${data.document.markdown.length.toLocaleString('en-US')} chars`"
      >
        <!-- Rendered as text, never as HTML: this is exactly the string the
             API returns, and scraped markup never becomes live markup here. -->
        <div class="max-h-[32rem] overflow-y-auto border border-rule-soft bg-surface p-4">
          <p class="readout text-ink">{{ data.document.markdown }}</p>
        </div>
      </DzPanel>

      <DzPanel
        v-if="data.document.links?.length"
        label="Links"
        soft
        :meta="`${data.document.links.length} found`"
      >
        <ul class="max-h-80 divide-y divide-rule-soft overflow-y-auto border border-rule-soft bg-surface">
          <li v-for="link in data.document.links" :key="link" class="px-3 py-1.5">
            <a
              :href="link"
              target="_blank"
              rel="noopener noreferrer nofollow"
              class="font-mono text-xs break-all text-ink-2 hover:text-ink hover:underline"
              >{{ link }}</a
            >
          </li>
        </ul>
      </DzPanel>

      <DzPanel
        v-if="data.document.rawHtml || data.document.html"
        label="HTML"
        soft
        :meta="`${(data.document.html ?? data.document.rawHtml ?? '').length.toLocaleString('en-US')} chars`"
      >
        <div class="max-h-96 overflow-y-auto border border-rule-soft bg-surface p-4">
          <p class="readout text-ink-2">{{ data.document.html ?? data.document.rawHtml }}</p>
        </div>
      </DzPanel>
    </div>
  </div>
</template>
