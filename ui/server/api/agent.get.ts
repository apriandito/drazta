/**
 * Whether the agent can run at all. The console asks before showing the form,
 * so a missing key is a plain statement up front rather than a failed run.
 */
export default defineEventHandler(() => ({
  ready: Boolean(process.env.OPENAI_API_KEY),
  model: process.env.DRAZTA_MODEL ?? "gpt-4o-mini",
  baseUrl: process.env.OPENAI_BASE_URL ?? null,
}));
