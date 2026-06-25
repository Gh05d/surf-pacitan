import type { ForecastDay, SpotRatings, SpotName, TideExtreme } from "../shared/types";
import { computeCandidateWindows, type CandidateWindow } from "./candidates";
import { ACTIVE_REGION } from "../shared/active-region";
import { tomorrowLocal, todayLocal } from "../shared/time";
import { closeoutWarningForPick } from "../shared/closeout";

export interface PayloadHourly {
  hour: number;
  tide: { height: number; rising: boolean };
  swell: { height: number; period: number; direction: number };
  wind: { speed: number; direction: number; gusts: number };
  weather: { condition: string; precipitation: number };
  surfable: SpotRatings;
}

export interface UserPayload {
  forDate: string;
  tideRange: number;
  astronomy: { sunrise: string; sunset: string };
  tideExtremes: TideExtreme[];
  candidateWindows: CandidateWindow[];
  hourly: PayloadHourly[];
}

const VALID_SPOTS: SpotName[] = ACTIVE_REGION.spots.map((s) => s.id);
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ValidationContext {
  candidates: CandidateWindow[];
  forecast: ForecastDay;
}

export interface ValidatedRecommendationFields {
  bestSpot: SpotName;
  bestWindow: { start: string; end: string };
  headline: string;
  reasoning: string;
  warnings: string[];
  overrideReason?: string;
}

export type ValidationResult =
  | { ok: true; value: ValidatedRecommendationFields }
  | { ok: false; error: string };

function parseHHMM(s: string): number | null {
  const m = HHMM_RE.exec(s);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function validateRecommendation(raw: unknown, context?: ValidationContext): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "raw is not an object" };
  const r = raw as Record<string, unknown>;

  if (typeof r.bestSpot !== "string" || !VALID_SPOTS.includes(r.bestSpot as SpotName)) {
    return { ok: false, error: `invalid bestSpot: ${String(r.bestSpot)}` };
  }
  const bestSpot = r.bestSpot as SpotName;

  if (!r.bestWindow || typeof r.bestWindow !== "object") {
    return { ok: false, error: "missing bestWindow" };
  }
  const w = r.bestWindow as Record<string, unknown>;
  if (typeof w.start !== "string" || typeof w.end !== "string") {
    return { ok: false, error: "bestWindow.start/end must be strings" };
  }
  const startMin = parseHHMM(w.start);
  const endMin = parseHHMM(w.end);
  if (startMin === null || endMin === null) {
    return { ok: false, error: "bestWindow times must be HH:MM" };
  }
  if (endMin <= startMin) {
    return { ok: false, error: "bestWindow.end must be after start" };
  }

  if (typeof r.headline !== "string" || r.headline.length === 0 || r.headline.length > 200) {
    return { ok: false, error: "headline must be non-empty <= 200 chars" };
  }
  if (typeof r.reasoning !== "string" || r.reasoning.length === 0 || r.reasoning.length > 600) {
    return { ok: false, error: "reasoning must be non-empty <= 600 chars" };
  }

  if (!Array.isArray(r.warnings)) {
    return { ok: false, error: "warnings must be an array" };
  }
  for (const wn of r.warnings) {
    if (typeof wn !== "string") return { ok: false, error: "warnings must be strings" };
    if (wn.length > 200) return { ok: false, error: "warning string too long (>200)" };
  }
  // The prompt promises max 3 warnings; over-filling models get truncated
  // rather than rejected (not worth burning the single retry on).
  const warnings = (r.warnings as string[]).slice(0, 3);

  // overrideReason: optional, <= 300 chars AFTER trimming; whitespace-only
  // counts as absent.
  let overrideReason: string | undefined;
  if (r.overrideReason !== undefined && r.overrideReason !== null) {
    if (typeof r.overrideReason !== "string") {
      return { ok: false, error: "overrideReason must be a string" };
    }
    const trimmed = r.overrideReason.trim();
    if (trimmed.length > 300) {
      return { ok: false, error: "overrideReason too long (>300)" };
    }
    overrideReason = trimmed || undefined;
  }

  // Candidate discipline (see 2026-06-07 candidate-windows spec): with
  // candidates present, the pick must follow the top candidate (±1h) or
  // justify the deviation; red hours are never allowed. The window-sanity
  // checks (hours exist, roughly daylight) apply whenever we have a forecast
  // context — including the fully-red day, where the red floor necessarily
  // can't apply but a 02:00–04:00 pick must still be rejected.
  let deviatesFromTop = false;
  if (context) {
    const ratingsByHour = new Map(context.forecast.hourly.map((h) => [h.hour, h.surfable]));
    // Hours overlapped by [start, end): end 08:00 doesn't touch hour 8, 08:01 does.
    const firstHour = Math.floor(startMin / 60);
    const lastHour = Math.ceil(endMin / 60) - 1;
    for (let h = firstHour; h <= lastHour; h += 1) {
      if (!ratingsByHour.has(h)) {
        return { ok: false, error: `bestWindow hour ${h} outside forecast hours` };
      }
    }

    const sunriseMin = parseHHMM(context.forecast.astronomy.sunrise);
    const sunsetMin = parseHHMM(context.forecast.astronomy.sunset);
    if (
      sunriseMin !== null &&
      sunsetMin !== null &&
      (startMin < sunriseMin - 60 || endMin > sunsetMin + 60)
    ) {
      return { ok: false, error: "bestWindow outside daylight" };
    }

    if (context.candidates.length > 0) {
      for (let h = firstHour; h <= lastHour; h += 1) {
        if (ratingsByHour.get(h)?.[bestSpot] === "red") {
          return { ok: false, error: `bestWindow contains red hour ${h} for ${bestSpot}` };
        }
      }

      const top = context.candidates[0];
      const topStart = parseHHMM(top.start);
      const topEnd = parseHHMM(top.end);
      const followsTop =
        bestSpot === top.spot &&
        topStart !== null &&
        topEnd !== null &&
        Math.abs(startMin - topStart) <= 60 &&
        Math.abs(endMin - topEnd) <= 60;
      if (!followsTop && !overrideReason) {
        return { ok: false, error: "deviates from top candidate without overrideReason" };
      }
      deviatesFromTop = !followsTop;
    }
  }

  return {
    ok: true,
    value: {
      bestSpot,
      bestWindow: { start: w.start, end: w.end },
      headline: r.headline,
      reasoning: r.reasoning,
      warnings,
      // Only persist the reason when the pick actually deviates — models love
      // to over-fill optional fields, and the card renders this as "differs
      // from the top window".
      ...(overrideReason && deviatesFromTop ? { overrideReason } : {}),
    },
  };
}

export function buildUserPayload(forecast: ForecastDay): UserPayload {
  const heights = forecast.tideExtremes.map((t) => t.height);
  const tideRange = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;

  return {
    forDate: forecast.date,
    tideRange,
    astronomy: forecast.astronomy,
    tideExtremes: forecast.tideExtremes,
    candidateWindows: computeCandidateWindows(forecast),
    hourly: forecast.hourly.map((h) => ({
      hour: h.hour,
      tide: h.tide,
      swell: h.swell,
      wind: h.wind,
      weather: { condition: h.weather.condition, precipitation: h.weather.precipitation },
      surfable: h.surfable,
    })),
  };
}

import {
  getCachedDay as defaultGetCachedDay,
  setRecommendation as defaultSetRecommendation,
  getRecommendation as defaultGetRecommendation,
  getRatingSignature as defaultGetRatingSignature,
  setRatingSignature as defaultSetRatingSignature,
} from "./cache";
import { ratingSignature } from "../shared/rating-signature";
import { callDeepSeek as defaultCallDeepSeek, type DeepSeekResult } from "./deepseek";
import { callClaudeCli as defaultCallClaudeCli, type ClaudeCliResult } from "./claude-cli";
import { buildSystemPrompt } from "./knowledge-base";
import {
  DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL,
  DEEPSEEK_THINKING,
  DEEPSEEK_TIMEOUT_MS,
  RECOMMENDATION_CLI_ENABLED,
  RECOMMENDATION_CLI_MODEL,
  RECOMMENDATION_CLI_TIMEOUT_MS,
  TIMEZONE,
  SPOT_THRESHOLDS,
} from "./config";
import type { Recommendation } from "../shared/types";

export interface GenerateDeps {
  getCachedDay: typeof defaultGetCachedDay;
  setRecommendation: typeof defaultSetRecommendation;
  getRecommendation: typeof defaultGetRecommendation;
  getRatingSignature: typeof defaultGetRatingSignature;
  setRatingSignature: typeof defaultSetRatingSignature;
  callDeepSeek: (opts: {
    apiKey: string;
    model: string;
    systemPrompt: string;
    userPayload: unknown;
    thinking: boolean;
    timeoutMs: number;
  }) => Promise<DeepSeekResult>;
  callClaudeCli: (opts: {
    model: string;
    systemPrompt: string;
    userPayload: unknown;
    timeoutMs: number;
  }) => Promise<ClaudeCliResult>;
  now: () => Date;
  apiKey: string;
  model: string;
  thinking: boolean;
  timeoutMs: number;
  claudeCliEnabled: boolean;
  claudeCliModel: string;
  claudeCliTimeoutMs: number;
}

const DEFAULT_DEPS: GenerateDeps = {
  getCachedDay: defaultGetCachedDay,
  setRecommendation: defaultSetRecommendation,
  getRecommendation: defaultGetRecommendation,
  getRatingSignature: defaultGetRatingSignature,
  setRatingSignature: defaultSetRatingSignature,
  callDeepSeek: defaultCallDeepSeek,
  callClaudeCli: defaultCallClaudeCli,
  now: () => new Date(),
  apiKey: DEEPSEEK_API_KEY,
  model: DEEPSEEK_MODEL,
  thinking: DEEPSEEK_THINKING,
  timeoutMs: DEEPSEEK_TIMEOUT_MS,
  claudeCliEnabled: RECOMMENDATION_CLI_ENABLED,
  claudeCliModel: RECOMMENDATION_CLI_MODEL,
  claudeCliTimeoutMs: RECOMMENDATION_CLI_TIMEOUT_MS,
};

// forDateOverride: generate for a specific date instead of "tomorrow (WIB)".
// Needed for manual recovery — after midnight WIB, "tomorrow" has moved past
// the missed date, so the default can never backfill it.
export async function generateTomorrowRecommendation(
  deps: GenerateDeps = DEFAULT_DEPS,
  forDateOverride?: string,
): Promise<void> {
  // Provider chain (meme-scraper Don pattern): Claude CLI (subscription,
  // free) is the primary; DeepSeek (metered API) only the fallback. Each
  // provider gets 2 attempts (call + validation failures both retry once).
  const providers: ("claude-cli" | "deepseek")[] = [];
  if (deps.claudeCliEnabled) providers.push("claude-cli");
  if (deps.apiKey) providers.push("deepseek");
  if (providers.length === 0) {
    console.warn("[recommendation] no provider available (CLI disabled, no DEEPSEEK_API_KEY); skipping");
    return;
  }

  const forDate = forDateOverride ?? tomorrowLocal(TIMEZONE, deps.now());
  const forecast = await deps.getCachedDay(forDate);
  if (!forecast) {
    console.warn(`[recommendation] no cached forecast for ${forDate}; skipping`);
    return;
  }

  const userPayload = buildUserPayload(forecast);
  const systemPrompt = buildSystemPrompt();

  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let content: unknown;
      let modelUsed: string;
      let tokensNote = "";
      try {
        if (provider === "claude-cli") {
          const result = await deps.callClaudeCli({
            model: deps.claudeCliModel,
            systemPrompt,
            userPayload,
            timeoutMs: deps.claudeCliTimeoutMs,
          });
          content = result.content;
          modelUsed = result.model ?? `claude-cli:${deps.claudeCliModel}`;
        } else {
          const result = await deps.callDeepSeek({
            apiKey: deps.apiKey,
            model: deps.model,
            systemPrompt,
            userPayload,
            thinking: deps.thinking,
            timeoutMs: deps.timeoutMs,
          });
          content = result.content;
          modelUsed = deps.model;
          tokensNote = ` (tokens used: ${result.usage.total_tokens})`;
        }
      } catch (err) {
        // Call failures are often transient (CLI queueing, thinking overran
        // max_tokens, network blip, 5xx) — retry once like validation
        // failures. 2026-06-07: a single truncated response killed the whole
        // night's rec because this path returned immediately. Final failure
        // still preserves the cached rec.
        console.error(`[recommendation] ${provider} attempt ${attempt} call failed:`, err);
        continue;
      }

      const validation = validateRecommendation(content, {
        candidates: userPayload.candidateWindows,
        forecast,
      });
      if (!validation.ok) {
        const picked = content as Record<string, unknown> | null;
        console.warn(
          `[recommendation] ${provider} attempt ${attempt} validation failed: ${validation.error}` +
            ` (model picked ${String(picked?.bestSpot)} ${JSON.stringify(picked?.bestWindow ?? null).slice(0, 200)})`,
        );
        continue;
      }

      const closeoutWarn = closeoutWarningForPick(
        forecast,
        validation.value.bestSpot,
        validation.value.bestWindow,
        SPOT_THRESHOLDS[validation.value.bestSpot]?.closeout,
      );
      // Prepend (not append) the deterministic close-out warning so it
      // survives the 3-warning cap even when the model already filled all 3
      // slots — observed live 2026-06-25, where appending dropped it. It also
      // earns top billing: for these sandbar spots a close-out is the most
      // actionable risk.
      const warnings =
        closeoutWarn && !validation.value.warnings.includes(closeoutWarn)
          ? [closeoutWarn, ...validation.value.warnings].slice(0, 3)
          : validation.value.warnings;

      const rec: Recommendation = {
        forDate,
        generatedAt: deps.now().toISOString(),
        bestSpot: validation.value.bestSpot,
        bestWindow: validation.value.bestWindow,
        headline: validation.value.headline,
        reasoning: validation.value.reasoning,
        warnings,
        ...(validation.value.overrideReason ? { overrideReason: validation.value.overrideReason } : {}),
        modelUsed,
      };

      await deps.setRecommendation(rec);
      await deps.setRatingSignature(forDate, ratingSignature(forecast));
      console.log(`[recommendation] wrote rec for ${forDate} via ${provider}${tokensNote}`);
      return;
    }
    console.error(`[recommendation] ${provider} exhausted (2 attempts)${provider === "claude-cli" && providers.includes("deepseek") ? "; falling back to deepseek" : ""}`);
  }
  console.error("[recommendation] all providers failed; keeping existing cached rec");
}

// Morning recheck (cron at RECOMMENDATION_RECHECK_LOCAL_HOUR): regenerate today's
// rec only if its rating categories drifted since generation. The chart re-rates
// every 3h, so the 20:00 snapshot can contradict the morning chart (2026-06-20:
// a recommended-green 08:00 hour drifted to red overnight). A missing rec is
// generated (recovery for a missed evening run).
export async function recheckTodayRecommendation(
  deps: GenerateDeps = DEFAULT_DEPS,
): Promise<void> {
  const today = todayLocal(TIMEZONE, deps.now());
  const forecast = await deps.getCachedDay(today);
  if (!forecast) {
    console.warn(`[recommendation] recheck: no cached forecast for ${today}; skipping`);
    return;
  }

  const rec = await deps.getRecommendation(today);
  if (!rec) {
    console.log(`[recommendation] recheck: no rec for ${today}; generating`);
    await generateTomorrowRecommendation(deps, today);
    return;
  }

  const sigNow = ratingSignature(forecast);
  const sigBase = await deps.getRatingSignature(today);
  if (sigBase === sigNow) {
    console.log(`[recommendation] recheck: ratings unchanged for ${today}; keeping rec`);
    return;
  }

  console.log(
    `[recommendation] recheck: ratings changed for ${today} (baseline ${sigBase ? "differs" : "missing"}); regenerating`,
  );
  await generateTomorrowRecommendation(deps, today);
}
