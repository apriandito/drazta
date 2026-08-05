<script setup lang="ts">
/**
 * The signature of this console.
 *
 * A structured record, one field per row, and every row carries the stamp of
 * the layer that produced it. No value appears here without saying where it
 * came from — that is the whole argument the library makes, rendered.
 */
const props = defineProps<{
  record: Record<string, unknown>;
  sources: Record<string, string>;
  /** Fields rendered elsewhere (the body, usually) — listed, never silently dropped. */
  omit?: string[];
}>();

const HIDDEN = new Set(["sources", "url"]);

const rows = computed(() =>
  Object.entries(props.record)
    .filter(([key]) => !HIDDEN.has(key) && !(props.omit ?? []).includes(key))
    .map(([key, value]) => ({
      key,
      value,
      source: props.sources?.[key] ?? "none",
      empty: value === null || value === undefined || value === "",
    })),
);

const found = computed(() => rows.value.filter((r) => !r.empty).length);

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("en-US");
  return String(value);
}

const isImage = (key: string) => key === "image";
const isLink = (value: unknown) => typeof value === "string" && /^https?:\/\//.test(value);
</script>

<template>
  <div>
    <p class="mb-3 font-mono text-[11px] text-ink-3">
      {{ found }} of {{ rows.length }} fields found
    </p>

    <dl class="divide-y divide-rule-soft border-y border-rule-soft">
      <div
        v-for="row in rows"
        :key="row.key"
        class="grid grid-cols-[minmax(0,7.5rem)_1fr] items-start gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,9rem)_1fr_auto]"
      >
        <dt class="font-mono text-xs text-ink-2">{{ row.key }}</dt>

        <dd
          class="min-w-0 font-mono text-[13px] break-words"
          :class="row.empty ? 'text-ink-3' : 'text-ink'"
        >
          <img
            v-if="isImage(row.key) && isLink(row.value)"
            :src="String(row.value)"
            :alt="''"
            class="mb-1.5 max-h-28 max-w-full border border-rule-soft object-contain"
            loading="lazy"
          />
          <a
            v-if="isLink(row.value)"
            :href="String(row.value)"
            target="_blank"
            rel="noopener noreferrer nofollow"
            class="underline decoration-rule underline-offset-2 hover:decoration-ink"
          >{{ display(row.value) }}</a>
          <template v-else>{{ display(row.value) }}</template>
        </dd>

        <dd class="col-start-2 sm:col-start-3 sm:justify-self-end">
          <DzStamp :source="row.source" />
        </dd>
      </div>
    </dl>
  </div>
</template>
