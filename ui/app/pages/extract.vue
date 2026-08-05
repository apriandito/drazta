<script setup lang="ts">
import type { Article, DocumentMetadata, Product } from "~/types/api";

useHead({ title: "Extract · Drazta" });

const form = reactive({
  url: "",
  kind: "article" as "article" | "product",
  requiresJs: false,
});

const { pending, data, failure, go } = useRun<{
  kind: "article" | "product";
  record: Article | Product;
  metadata: DocumentMetadata;
  markdown: string | null;
}>("/api/extract");

const KINDS = [
  { value: "article", label: "Article", gloss: "news, blog posts" },
  { value: "product", label: "Product", gloss: "shop listings" },
] as const;

/** The body is long-form; it gets its own panel instead of a table row. */
const OMIT = ["body", "description"];
</script>

<template>
  <div>
    <DzPageHead
      title="Extract a record"
      lede="The same function reads CNN, Detik, Kompas and a WooCommerce store — no per-site rules, no model. It leans on the SEO standards every site already emits, and stamps each field with the layer that produced it."
    />

    <DzPanel label="Request">
      <form class="flex flex-col gap-5" @submit.prevent="go({ ...form })">
        <div class="flex flex-col gap-3 sm:flex-row">
          <input
            v-model="form.url"
            class="input"
            type="text"
            inputmode="url"
            placeholder="https://finance.detik.com/…"
            aria-label="URL to extract from"
            required
          />
          <DzButton type="submit" :pending="pending" class="sm:w-40">
            {{ pending ? "Reading" : `Read ${form.kind}` }}
          </DzButton>
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <DzField label="Record type">
            <div class="flex gap-1.5">
              <button
                v-for="kind in KINDS"
                :key="kind.value"
                type="button"
                class="flex flex-col items-start border px-3 py-1.5 transition-colors"
                :class="
                  form.kind === kind.value
                    ? 'border-ink bg-ink text-surface'
                    : 'border-rule text-ink-2 hover:border-ink-3 hover:text-ink'
                "
                :aria-pressed="form.kind === kind.value"
                @click="form.kind = kind.value"
              >
                <span class="font-mono text-[11px] tracking-wider uppercase">{{ kind.label }}</span>
                <span class="font-mono text-[10px] opacity-70">{{ kind.gloss }}</span>
              </button>
            </div>
          </DzField>

          <div class="flex flex-col gap-2">
            <span class="eyebrow">Options</span>
            <DzCheck
              v-model="form.requiresJs"
              label="Needs a browser"
              hint="For shops and sites that render their JSON-LD client-side."
            />
          </div>
        </div>
      </form>
    </DzPanel>

    <div v-if="!data && !failure && !pending" class="mt-10">
      <DzLegend />
    </div>

    <div v-if="failure" class="mt-10">
      <DzPanel label="Failed">
        <DzFailure :failure="failure" />
      </DzPanel>
    </div>

    <div v-if="data" class="mt-10 flex flex-col gap-10">
      <DzPanel label="Receipt">
        <DzReceipt :metadata="data.metadata" :ms="data.ms" />
      </DzPanel>

      <DzPanel :label="`${data.kind} record`" :meta="data.record.url">
        <DzRecord
          :record="data.record as unknown as Record<string, unknown>"
          :sources="data.record.sources"
          :omit="OMIT"
        />
      </DzPanel>

      <DzPanel
        v-if="'description' in data.record && data.record.description"
        label="Description"
        soft
      >
        <div class="flex items-start gap-3">
          <DzStamp :source="data.record.sources.description ?? 'none'" />
          <p class="text-[15px] leading-relaxed text-ink">{{ data.record.description }}</p>
        </div>
      </DzPanel>

      <DzPanel
        v-if="'body' in data.record && data.record.body"
        label="Body"
        soft
        :meta="`${data.record.body.length.toLocaleString('en-US')} chars`"
      >
        <div class="mb-3 flex items-center gap-2.5">
          <DzStamp :source="data.record.sources.body ?? 'none'" />
          <span class="font-mono text-[11px] text-ink-3">
            {{
              data.record.sources.body === "json-ld"
                ? "articleBody, straight from the page's own structured data"
                : "recovered from the DOM by readability, not stated by the page"
            }}
          </span>
        </div>
        <div class="max-h-[32rem] overflow-y-auto border border-rule-soft bg-surface p-4">
          <p class="readout text-ink">{{ data.record.body }}</p>
        </div>
      </DzPanel>
    </div>
  </div>
</template>
