// Generic LLM prompt scaffold for the daily recommendation. Region expertise
// (geography, local wind pattern, tide ranges) comes from the region pack's
// knowledge-base file via the registry below; the input format, candidate
// rules, task, anti-hallucination rules, and output schema are
// region-independent and live here.
import type { RegionConfig } from "../shared/region";
import { ACTIVE_REGION } from "../shared/active-region";
import { PACITAN_KNOWLEDGE } from "../../regions/pacitan/knowledge-base";

// Server-only registry — keeps prompt text out of the client bundle (which is
// why RegionConfig has no knowledgeBase field).
const REGION_KNOWLEDGE: Record<string, string> = {
  pacitan: PACITAN_KNOWLEDGE,
};

export function buildSystemPrompt(region: RegionConfig = ACTIVE_REGION): string {
  const regional = REGION_KNOWLEDGE[region.id];
  if (!regional) {
    throw new Error(
      `no knowledge base registered for region "${region.id}" — add it to REGION_KNOWLEDGE in src/server/knowledge-base.ts`,
    );
  }

  const spotIdUnion = region.spots.map((s) => `"${s.id}"`).join(" | ");
  const surfableShape = region.spots
    .map((s, i) => (i === 0 ? `"${s.id}": "green"|"yellow"|"red"` : `"${s.id}": ...`))
    .join(", ");

  return `
${regional}

# Input Data Format

You receive a JSON object:
\`\`\`
{
  "forDate": "YYYY-MM-DD",
  "tideRange": number,            // meters
  "astronomy": { "sunrise": "HH:MM", "sunset": "HH:MM" },
  "tideExtremes": [{ "time": "HH:MM", "height": m, "type": "high"|"low" }],
  "candidateWindows": [{ "rank": 1, "spot": ${spotIdUnion}, "start": "HH:00", "end": "HH:00",
                         "ratings": "10g 11g", "greens": 2, "risingShare": 0..1, "meanWind": km/h }],
  "hourly": [{ "hour": 0-23, "tide": {height, rising}, "swell": {height, period, direction},
               "wind": {speed, direction, gusts}, "weather": {condition, precipitation},
               "surfable": { ${surfableShape} } }]
}
\`\`\`

# Candidate Windows

\`candidateWindows\` are the best surf windows computed from the per-hour \`surfable\` ratings, ranked best-first (rank 1 = best window of the day).

- DEFAULT: recommend candidate rank 1 unchanged (same spot, same start/end).
- You MAY deviate ONLY when specific hourly data gives a concrete reason. A deviation means: a different spot than rank 1, OR a window whose start or end moves more than 1 hour from rank 1's. (Nudging rank 1's own window by up to 1 hour is not a deviation — no reason needed.) For any real deviation you MUST fill \`overrideReason\`, citing the data with numbers (max 300 chars, e.g. "wind jumps 12→22 km/h at 10:00").
- When you follow candidate rank 1, omit \`overrideReason\`.
- NEVER recommend a window that includes an hour rated "red" for the chosen spot.
- A candidate can be the best window of the day even with \`greens: 0\` (all-yellow). On marginal days still DEFAULT to rank 1 — recommend it and note in \`warnings\` that conditions are marginal. If you genuinely prefer a different window, that is a deviation and requires \`overrideReason\`.
- If \`candidateWindows\` is empty (fully red day), recommend the least-bad daylight window and warn clearly.

# Task

Recommend exactly **one** best spot and **one** best window for \`forDate\`. Give 2–3 sentences of reasoning. Respond in **English**. List up to 3 short warnings if relevant (e.g. wind flipping early, strong current, rain). Otherwise leave the list empty.

# Anti-Hallucination

- Only reference values from the provided forecast object
- Do not invent numbers, trends, swell pulses, or weather events that aren't in the data
- If conditions are marginal or ambiguous, say so explicitly
- \`bestWindow\` start AND end MUST fall within 00:00–23:59 of \`forDate\`
- Never surf before sunrise or after sunset — respect \`astronomy\`

# Output

Respond with EXACTLY this JSON schema (no extra fields, no markdown, no prose outside). All string values must be in English:

\`\`\`
{
  "bestSpot": ${spotIdUnion},
  "bestWindow": { "start": "HH:MM", "end": "HH:MM" },
  "headline": "one short sentence in English, max 200 chars",
  "reasoning": "2–3 sentences in English explaining why this spot in this window, max 600 chars",
  "warnings": ["short warnings in English, max 200 chars each, max 3 entries"],
  "overrideReason": "ONLY when deviating from candidate rank 1: the concrete data-grounded reason, max 300 chars. Omit otherwise."
}
\`\`\`
`.trim();
}
