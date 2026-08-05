<script setup lang="ts">
import type { DeepSourceReport, DocumentMetadata, TablePreview, TidyPreview } from "~/types/api";

useHead({ title: "Tables · Drazta" });

const mode = ref<"one" | "many">("one");

/* ---- one page ---------------------------------------------------------- */

const single = reactive({ url: "", snakeCase: false, requiresJs: false });
const chosen = ref(0);

const one = useRun<{
  tables: TablePreview[];
  previewRows: number;
  metadata: DocumentMetadata;
}>("/api/tables");

async function runSingle() {
  chosen.value = 0;
  await one.go({ ...single });
}

const table = computed(() => one.data.value?.tables[chosen.value] ?? null);

/* ---- many pages -------------------------------------------------------- */

const many = reactive({
  merge: "union" as "union" | "join",
  key: "@first",
  sourceColumn: "page",
  snakeCase: true,
  sources: [
    { url: "", label: "" },
    { url: "", label: "" },
  ] as { url: string; label: string }[],
});

const deep = useRun<{
  merge: "union" | "join";
  matchedKeys: number | null;
  sources: DeepSourceReport[];
  table: TidyPreview;
  previewRows: number;
}>("/api/deep");

function addSource() {
  many.sources.push({ url: "", label: "" });
}

function removeSource(index: number) {
  if (many.sources.length > 1) many.sources.splice(index, 1);
}

async function runDeep() {
  await deep.go({
    merge: many.merge,
    key: many.key,
    sourceColumn: many.sourceColumn,
    snakeCase: many.snakeCase,
    sources: many.sources.filter((s) => s.url.trim()),
  });
}

const failed = computed(() => deep.data.value?.sources.filter((s) => s.error) ?? []);

const deepFigures = computed(() => {
  const d = deep.data.value;
  if (!d) return [];
  const out = [
    { value: d.table.rowCount.toLocaleString("en-US"), label: "rows out" },
    { value: `${d.sources.length - failed.value.length}/${d.sources.length}`, label: "pages with a table" },
  ];
  // Only a join has keys to match, and that count is the whole point of one.
  if (d.matchedKeys !== null) {
    out.push({ value: d.matchedKeys.toLocaleString("en-US"), label: "keys in 2+ sources" });
  }
  out.push(
    d.ms >= 1000
      ? { value: (d.ms / 1000).toFixed(1), label: "seconds" }
      : { value: String(d.ms), label: "milliseconds" },
  );
  return out;
});

/* ---- export ------------------------------------------------------------ */

function saveCsv(preview: { columns: TidyPreview["columns"]; rows: TidyPreview["rows"] }, url: string) {
  downloadText(`${slugFromUrl(url)}.csv`, toCsv(preview.columns, preview.rows));
}
</script>

<template>
  <div>
    <DzPageHead
      title="Tables to typed rows"
      lede="Statistics sites keep the payload in tables, not prose. Each column gets a type inferred from its cells, footnote markers are stripped, and “1.250” is read as 1250 while “4.8” stays 4.8 — Indonesian and US number formats both land correctly."
    />

    <div class="mb-8 flex gap-1.5">
      <button
        v-for="tab in [
          { value: 'one', label: 'One page', gloss: 'every table on a URL' },
          { value: 'many', label: 'Many pages', gloss: 'merge into one dataset' },
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
        @click="mode = tab.value as 'one' | 'many'"
      >
        <span class="font-mono text-[11px] tracking-wider uppercase">{{ tab.label }}</span>
        <span class="font-mono text-[10px] opacity-70">{{ tab.gloss }}</span>
      </button>
    </div>

    <!-- ================= one page ================= -->
    <template v-if="mode === 'one'">
      <DzPanel label="Request">
        <form class="flex flex-col gap-5" @submit.prevent="runSingle">
          <div class="flex flex-col gap-3 sm:flex-row">
            <input
              v-model="single.url"
              class="input"
              type="text"
              inputmode="url"
              placeholder="https://en.wikipedia.org/wiki/List_of_countries_by_population"
              aria-label="URL to read tables from"
              required
            />
            <DzButton type="submit" :pending="one.pending.value" class="sm:w-40">
              {{ one.pending.value ? "Reading" : "Read tables" }}
            </DzButton>
          </div>
          <div class="flex flex-col gap-2">
            <span class="eyebrow">Options</span>
            <DzCheck
              v-model="single.snakeCase"
              label="snake_case columns"
              hint="Rename headers for SQL and DuckDB."
            />
            <DzCheck v-model="single.requiresJs" label="Needs a browser" />
          </div>
        </form>
      </DzPanel>

      <div v-if="!one.data.value && !one.failure.value && !one.pending.value" class="mt-10">
        <DzEmpty
          label="What tidying does"
          :rows="[
            {
              term: 'column types',
              says: 'Each column is classified from its own cells — number, percent, date, or text — and shown in the header.',
            },
            {
              term: 'numbers',
              says: '“1.250” becomes 1250 and “4.8” stays 4.8. Indonesian and US formats are disambiguated, not guessed at once and applied everywhere.',
            },
            {
              term: 'footnotes',
              says: 'Markers like [4] are stripped from cells before the type is inferred.',
            },
            {
              term: 'blanks',
              says: 'Empty cells become null rather than an empty string, so they survive into SQL as missing data.',
            },
          ]"
        />
      </div>

      <div v-if="one.failure.value" class="mt-10">
        <DzPanel label="Failed"><DzFailure :failure="one.failure.value" /></DzPanel>
      </div>

      <div v-if="one.data.value" class="mt-10 flex flex-col gap-10">
        <DzPanel label="Receipt">
          <DzReceipt :metadata="one.data.value.metadata" :ms="one.data.value.ms" />
        </DzPanel>

        <DzPanel
          v-if="!one.data.value.tables.length"
          label="No tables"
          soft
        >
          <p class="text-[15px] text-ink-2">
            This page has no table with at least 2 rows and 2 columns. If the data is rendered by
            script, turn on “Needs a browser” and read it again.
          </p>
        </DzPanel>

        <template v-else>
          <DzPanel
            label="Tables found"
            :meta="`${one.data.value.tables.length} on this page`"
            soft
          >
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="t in one.data.value.tables"
                :key="t.index"
                type="button"
                class="border px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors"
                :class="
                  chosen === t.index
                    ? 'border-ink bg-ink text-surface'
                    : 'border-rule text-ink-2 hover:border-ink-3 hover:text-ink'
                "
                :aria-pressed="chosen === t.index"
                @click="chosen = t.index"
              >
                <span class="block">#{{ t.index }} · {{ t.rowCount }}×{{ t.colCount }}</span>
                <span v-if="t.caption" class="block max-w-44 truncate opacity-70">{{ t.caption }}</span>
              </button>
            </div>
          </DzPanel>

          <DzPanel
            v-if="table"
            :label="table.caption || `Table #${table.index}`"
            :meta="`${table.rowCount.toLocaleString('en-US')} rows · ${table.columns.length} columns`"
          >
            <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p v-if="table.truncated" class="font-mono text-[11px] text-ink-3">
                Showing the first {{ one.data.value.previewRows }} rows of
                {{ table.rowCount.toLocaleString("en-US") }}.
              </p>
              <span v-else />
              <DzButton variant="quiet" @click="saveCsv(table, single.url)">
                Save {{ table.rows.length.toLocaleString("en-US") }} rows as CSV
              </DzButton>
            </div>
            <DzTable :columns="table.columns" :rows="table.rows" />
          </DzPanel>
        </template>
      </div>
    </template>

    <!-- ================= many pages ================= -->
    <template v-else>
      <DzPanel label="Sources">
        <form class="flex flex-col gap-5" @submit.prevent="runDeep">
          <div class="flex flex-col gap-2">
            <div
              v-for="(source, i) in many.sources"
              :key="i"
              class="flex flex-col gap-2 sm:flex-row"
            >
              <input
                v-model="source.url"
                class="input sm:flex-1"
                type="text"
                inputmode="url"
                :placeholder="`Page ${i + 1} URL`"
                :aria-label="`Source ${i + 1} URL`"
              />
              <input
                v-model="source.label"
                class="input sm:w-40"
                type="text"
                :placeholder="many.merge === 'join' ? 'suffix, e.g. 2024' : 'label'"
                :aria-label="`Source ${i + 1} label`"
              />
              <button
                type="button"
                class="border border-rule px-3 py-2 font-mono text-[11px] text-ink-3 transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
                :disabled="many.sources.length <= 1"
                :aria-label="`Remove source ${i + 1}`"
                @click="removeSource(i)"
              >
                Remove
              </button>
            </div>
            <DzButton variant="quiet" class="w-fit" @click="addSource">Add a page</DzButton>
          </div>

          <div class="grid gap-5 sm:grid-cols-2">
            <DzField
              label="Merge"
              :hint="
                many.merge === 'union'
                  ? 'Stack rows from pages that share a schema — paginated lists, one page per year.'
                  : 'Widen by a key column, so one page per year becomes one row per region.'
              "
            >
              <div class="flex gap-1.5">
                <button
                  v-for="m in ['union', 'join']"
                  :key="m"
                  type="button"
                  class="border px-3 py-1.5 font-mono text-[11px] tracking-wider uppercase transition-colors"
                  :class="
                    many.merge === m
                      ? 'border-ink bg-ink text-surface'
                      : 'border-rule text-ink-2 hover:border-ink-3 hover:text-ink'
                  "
                  :aria-pressed="many.merge === m"
                  @click="many.merge = m as 'union' | 'join'"
                >
                  {{ m }}
                </button>
              </div>
            </DzField>

            <DzField
              v-if="many.merge === 'join'"
              label="Join key"
              hint="A column name, or @first to use each table's first column."
            >
              <input v-model="many.key" class="input" type="text" placeholder="@first" />
            </DzField>

            <DzField
              v-else
              label="Source column"
              hint="Tags each row with the page it came from. Leave empty to skip."
            >
              <input v-model="many.sourceColumn" class="input" type="text" placeholder="page" />
            </DzField>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-4">
            <DzCheck v-model="many.snakeCase" label="snake_case columns" />
            <DzButton type="submit" :pending="deep.pending.value" class="w-full sm:w-48">
              {{ deep.pending.value ? "Merging" : "Merge pages" }}
            </DzButton>
          </div>
        </form>
      </DzPanel>

      <div v-if="deep.failure.value" class="mt-10">
        <DzPanel label="Failed"><DzFailure :failure="deep.failure.value" /></DzPanel>
      </div>

      <div v-if="deep.data.value" class="mt-10 flex flex-col gap-10">
        <DzPanel label="Receipt">
          <DzFigures :figures="deepFigures" />

          <ul v-if="failed.length" class="mt-5 flex flex-col gap-1.5">
            <li
              v-for="src in failed"
              :key="src.url"
              class="flex flex-wrap items-baseline gap-2 border-l-2 border-degraded bg-degraded-bg px-3 py-1.5"
            >
              <span class="font-mono text-[11px] break-all text-ink">{{ src.url }}</span>
              <span class="font-mono text-[11px] text-degraded">{{ src.error }}</span>
            </li>
          </ul>
        </DzPanel>

        <DzPanel
          label="Merged dataset"
          :meta="`${deep.data.value.table.rowCount.toLocaleString('en-US')} rows · ${deep.data.value.table.columns.length} columns`"
        >
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p v-if="deep.data.value.table.truncated" class="font-mono text-[11px] text-ink-3">
              Showing the first {{ deep.data.value.previewRows }} rows of
              {{ deep.data.value.table.rowCount.toLocaleString("en-US") }}.
            </p>
            <span v-else />
            <DzButton
              variant="quiet"
              @click="saveCsv(deep.data.value.table, many.sources[0]?.url ?? 'merged')"
            >
              Save {{ deep.data.value.table.rows.length.toLocaleString("en-US") }} rows as CSV
            </DzButton>
          </div>
          <DzTable :columns="deep.data.value.table.columns" :rows="deep.data.value.table.rows" />
        </DzPanel>
      </div>
    </template>
  </div>
</template>
