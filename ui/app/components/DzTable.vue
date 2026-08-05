<script setup lang="ts">
import type { TidyColumn } from "~/types/api";

/**
 * A tidy table, with its inferred column types kept visible in the header —
 * the type is a claim Drazta made about the data, so it belongs on screen next
 * to the data it describes.
 */
defineProps<{
  columns: TidyColumn[];
  rows: Record<string, string | number | null>[];
}>();

const TYPE_LABEL: Record<string, string> = {
  number: "num",
  percent: "pct",
  date: "date",
  text: "text",
};

/** Right-align what the eye compares as a quantity. */
const NUMERIC = new Set(["number", "percent"]);

function cell(value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("en-US");
  return String(value);
}
</script>

<template>
  <div class="overflow-x-auto border border-rule-soft bg-surface">
    <table class="w-full border-collapse font-mono text-xs">
      <thead>
        <tr class="border-b border-rule">
          <th
            v-for="col in columns"
            :key="col.name"
            scope="col"
            class="px-3 py-2 text-left align-bottom"
          >
            <!-- Real pages produce real junk: a scraped header can be a
                 thousand characters of inlined CSS. Cap it, keep the full
                 value one hover away, and never let it stretch the table. -->
            <span class="block max-w-56 truncate text-ink" :title="col.name">{{ col.name }}</span>
            <span class="mt-0.5 block text-[10px] tracking-wider text-ink-3 uppercase">
              {{ TYPE_LABEL[col.type] ?? col.type }}
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, i) in rows"
          :key="i"
          class="border-b border-rule-soft last:border-0 hover:bg-sunk"
        >
          <td
            v-for="col in columns"
            :key="col.name"
            class="max-w-56 truncate px-3 py-1.5 align-top"
            :class="[
              row[col.name] === null || row[col.name] === '' ? 'text-ink-3' : 'text-ink',
              NUMERIC.has(col.type) ? 'text-right tabular-nums' : '',
            ]"
            :title="cell(row[col.name] ?? null)"
          >
            {{ cell(row[col.name] ?? null) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
