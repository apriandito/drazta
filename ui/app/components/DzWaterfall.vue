<script setup lang="ts">
import type { RoutingPlan } from "~/types/api";

/**
 * The waterfall — the page's one memorable element.
 *
 * Drazta's routing is scored, not branched: a request becomes a set of required
 * capabilities, each engine scores the priorities it covers, anything below half
 * the demand is dropped, and the survivors race in order. That is the whole
 * argument for the architecture, and it was the least visible thing in this
 * console. Here it is, from `buildFallbackList`, re-planning as options change.
 *
 * The ordinals are earned: this really is a sequence, and its order is the
 * information.
 */
const props = defineProps<{
  plan: RoutingPlan;
  /** The engine that actually produced the document, once a run has happened. */
  winner?: string | null;
}>();

const summary = computed(() => {
  const { required, plan, dropped, forced } = props.plan;
  if (forced) return "One engine, forced by hand.";
  if (!required.length) return "Nothing required, so the order is pure quality — cheapest first.";
  return `Required: ${required.join(", ")}. ${plan.length} of ${plan.length + dropped.length} engines qualify.`;
});
</script>

<template>
  <div>
    <ol class="border-t border-rule-soft">
      <li
        v-for="step in plan.plan"
        :key="step.name"
        class="grid grid-cols-[2.5rem_1fr] items-start gap-x-4 border-b border-rule-soft py-4 sm:grid-cols-[3rem_1fr_auto] sm:gap-x-6"
        :class="winner === step.name ? 'bg-sunk' : ''"
      >
        <span
          class="ordinal pt-0.5 text-right"
          :class="winner === step.name ? 'text-ink' : 'text-ink-3'"
          aria-hidden="true"
        >
          {{ step.position }}
        </span>

        <div class="min-w-0">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              class="font-mono text-[15px] tracking-tight"
              :class="winner === step.name ? 'text-ink' : 'text-ink-2'"
            >
              {{ step.name }}
            </span>
            <!-- The elapsed time belongs to the receipt; repeating it here in a
                 different unit only invites doubt about which is right. -->
            <span
              v-if="winner === step.name"
              class="bg-ink px-1.5 py-px font-mono text-[10px] tracking-wider text-surface uppercase"
            >
              won
            </span>
          </div>

          <p class="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span class="font-mono text-[10px] tracking-wider text-ink-3 uppercase">covers</span>
            <span
              v-for="feature in step.covers"
              :key="feature"
              class="font-mono text-[11px] text-ink-2"
            >
              {{ feature }}
            </span>
            <span v-if="!step.covers.length" class="font-mono text-[11px] text-ink-3">nothing</span>
          </p>
        </div>

        <dl
          class="col-start-2 mt-2 flex gap-x-5 font-mono text-[11px] sm:col-start-3 sm:mt-0 sm:flex-col sm:gap-x-0 sm:gap-y-1 sm:text-right"
        >
          <div class="flex gap-1.5 sm:justify-end">
            <dt class="text-ink-3">quality</dt>
            <dd class="text-ink-2 tabular-nums">{{ step.quality }}</dd>
          </div>
          <div v-if="plan.demand" class="flex gap-1.5 sm:justify-end">
            <dt class="text-ink-3">covers</dt>
            <dd class="text-ink-2 tabular-nums">{{ step.supportScore }}/{{ plan.demand }}</dd>
          </div>
        </dl>
      </li>
    </ol>

    <div v-if="plan.dropped.length" class="mt-4 flex flex-col gap-1.5">
      <span class="eyebrow text-ink-3">Dropped below the threshold</span>
      <p
        v-for="engine in plan.dropped"
        :key="engine.name"
        class="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-ink-3"
      >
        <span class="line-through">{{ engine.name }}</span>
        <span>lacks {{ engine.lacks.join(", ") || "nothing scored" }}</span>
      </p>
    </div>

    <p class="mt-5 max-w-2xl text-[13px] leading-relaxed text-ink-2">
      {{ summary }} Engines do not wait their turn — once one has had its
      <span class="font-mono">maxReasonableTime</span>, the next starts alongside it and they race.
      The first good document wins and the losers are aborted.
      <template v-if="winner">
        Which means the engines below the winner may never have started at all; this list is the
        plan, not a record of what ran.
      </template>
    </p>
  </div>
</template>
