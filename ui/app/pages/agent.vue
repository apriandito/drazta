<script setup lang="ts">
import type { AgentFile } from "~/types/api";

useHead({ title: "Agent · Drazta" });

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const form = reactive({ task: "", maxSteps: 12 });

const { pending, data, failure, go } = useRun<{
  text: string;
  records: Record<string, unknown>[];
  recordCount: number;
  files: AgentFile[];
  maxFileBytes: number;
}>("/api/agent");

const { data: status } = await useFetch<{
  ready: boolean;
  model: string;
  baseUrl: string | null;
}>("/api/agent");

const EXAMPLES = [
  "Berita ekonomi syariah di CNBC Indonesia, jadikan Excel",
  "Collect the last 20 headlines from kompas.com/tren into a spreadsheet",
  "Ambil daftar produk dari toko ini beserta harganya, ekspor ke Excel",
];

function mimeFor(name: string) {
  return name.endsWith(".xlsx") ? XLSX_MIME : "application/octet-stream";
}

function size(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/** Columns are the union of every record's keys — records need not agree. */
const columns = computed(() => {
  const keys = new Set<string>();
  for (const record of data.value?.records ?? []) {
    for (const key of Object.keys(record)) keys.add(key);
  }
  return [...keys];
});
</script>

<template>
  <div>
    <DzPageHead
      title="Describe it, get the file"
      lede="A task in one sentence. The model plans; the tools that carry it out are the same map, scrape, extract and export code the rest of this console calls directly. Page content is stashed in a session and never floods the model's context — only compact summaries go back to it."
    />

    <DzPanel v-if="status && !status.ready" label="Not configured">
      <div class="border-l-2 border-degraded bg-degraded-bg px-4 py-3">
        <div class="flex items-center gap-2.5">
          <DzStamp source="degraded" />
          <span class="font-mono text-[11px] tracking-wider text-degraded uppercase">
            No API key
          </span>
        </div>
        <p class="mt-2 text-[15px] leading-relaxed text-ink">
          The agent is the one part of Drazta that needs a model. Set
          <code class="font-mono text-[13px]">OPENAI_API_KEY</code> and start the console again:
        </p>
        <pre
          class="mt-2.5 overflow-x-auto border border-degraded/30 bg-surface px-3 py-2 font-mono text-xs text-ink"
        >OPENAI_API_KEY=sk-… npm run ui</pre>
        <p class="mt-2.5 text-[13px] leading-relaxed text-ink-2">
          Everything else in this console — scrape, extract, tables, discover — is deterministic and
          runs without a key.
        </p>
      </div>
    </DzPanel>

    <DzPanel v-else label="Task">
      <form class="flex flex-col gap-5" @submit.prevent="go({ ...form })">
        <textarea
          v-model="form.task"
          class="input min-h-24 resize-y"
          placeholder="Berita ekonomi syariah di CNBC Indonesia, jadikan Excel"
          aria-label="Describe the task"
          required
        />

        <div class="flex flex-col gap-2">
          <span class="eyebrow">Try one</span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="example in EXAMPLES"
              :key="example"
              type="button"
              class="border border-rule px-2.5 py-1 text-left font-mono text-[11px] text-ink-2 transition-colors hover:border-ink hover:text-ink"
              @click="form.task = example"
            >
              {{ example }}
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-end justify-between gap-4">
          <DzField label="Max steps" hint="How many tool calls the model may take.">
            <input
              v-model.number="form.maxSteps"
              class="input w-28"
              type="number"
              min="1"
              max="30"
            />
          </DzField>
          <div class="flex flex-col items-end gap-1.5">
            <span v-if="status" class="font-mono text-[11px] text-ink-3">
              model · {{ status.model }}
            </span>
            <DzButton type="submit" :pending="pending" class="w-48">
              {{ pending ? "Working" : "Run the task" }}
            </DzButton>
          </div>
        </div>

        <p v-if="pending" class="font-mono text-[11px] text-ink-3">
          This runs a full map → scrape → extract → export pass. It can take a minute.
        </p>
      </form>
    </DzPanel>

    <div v-if="failure" class="mt-10">
      <DzPanel label="Failed"><DzFailure :failure="failure" /></DzPanel>
    </div>

    <div v-if="data" class="mt-10 flex flex-col gap-10">
      <DzPanel label="Receipt">
        <DzFigures
          :figures="[
            { value: data.recordCount.toLocaleString('en-US'), label: 'records' },
            { value: String(data.files.length), label: 'files' },
            { value: (data.ms / 1000).toFixed(1), label: 'seconds' },
          ]"
        />
      </DzPanel>

      <DzPanel v-if="data.files.length" label="Files">
        <ul class="flex flex-col gap-2">
          <li
            v-for="file in data.files"
            :key="file.name"
            class="flex flex-wrap items-center justify-between gap-3 border border-rule-soft bg-surface px-3 py-2.5"
          >
            <span class="flex items-baseline gap-3">
              <span class="font-mono text-[13px] text-ink">{{ file.name }}</span>
              <span class="font-mono text-[11px] text-ink-3">{{ size(file.size) }}</span>
            </span>
            <DzButton
              v-if="file.base64"
              variant="quiet"
              @click="downloadBase64(file.name, file.base64, mimeFor(file.name))"
            >
              Save file
            </DzButton>
            <span v-else class="font-mono text-[11px] text-degraded">
              too large to send to the browser — over {{ size(data.maxFileBytes) }}
            </span>
          </li>
        </ul>
      </DzPanel>

      <DzPanel v-if="data.text" label="What the agent did" soft>
        <p class="text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{{ data.text }}</p>
      </DzPanel>

      <DzPanel
        v-if="data.records.length"
        label="Records"
        soft
        :meta="`${data.recordCount.toLocaleString('en-US')} rows`"
      >
        <div class="mb-3 flex items-center justify-between gap-3">
          <p class="flex items-center gap-2 font-mono text-[11px] text-ink-3">
            <DzStamp source="llm" />
            <span>a model chose these fields — check them against the source</span>
          </p>
        </div>
        <div class="max-h-[32rem] overflow-auto border border-rule-soft bg-surface">
          <table class="w-full border-collapse font-mono text-xs">
            <thead class="sticky top-0 bg-surface">
              <tr class="border-b border-rule">
                <th
                  v-for="col in columns"
                  :key="col"
                  scope="col"
                  class="px-3 py-2 text-left whitespace-nowrap text-ink"
                >
                  {{ col }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(record, i) in data.records"
                :key="i"
                class="border-b border-rule-soft last:border-0 hover:bg-sunk"
              >
                <td
                  v-for="col in columns"
                  :key="col"
                  class="max-w-sm truncate px-3 py-1.5 align-top"
                  :class="record[col] == null || record[col] === '' ? 'text-ink-3' : 'text-ink'"
                  :title="record[col] == null ? '' : String(record[col])"
                >
                  {{ record[col] == null || record[col] === "" ? "—" : String(record[col]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </DzPanel>
    </div>
  </div>
</template>
