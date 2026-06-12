// Timezone-aware date/time helpers driven by IANA zone names. Conversion is
// per-timestamp via Intl — never a fixed offset — so DST zones (Europe/Lisbon,
// Morocco, ...) stay correct year-round. Pure module: no env reads, no I/O.

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;  // 0-23
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

// Throws RangeError on a non-finite epoch (formatToParts rejects NaN) —
// callers converting parsed timestamps must pre-validate Date.parse results.
export function localParts(epochMs: number, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(epochMs);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDateStr(epochMs: number, timeZone: string): string {
  const p = localParts(epochMs, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localHHMM(epochMs: number, timeZone: string): string {
  const p = localParts(epochMs, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function localHour(epochMs: number, timeZone: string): number {
  return localParts(epochMs, timeZone).hour;
}

export function todayLocal(timeZone: string, now: Date = new Date()): string {
  return localDateStr(now.getTime(), timeZone);
}

// Pure calendar arithmetic on a YYYY-MM-DD string — no timezone involved.
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function tomorrowLocal(timeZone: string, now: Date = new Date()): string {
  return addDays(todayLocal(timeZone, now), 1);
}

// Epoch (ms) of the wall-clock time `dateStr hour:minute` in `timeZone`.
// Two-pass offset correction. Contract: callers pass REAL wall-clock times.
// A nonexistent local time (DST spring-forward gap) resolves to an
// UNSPECIFIED adjacent instant (before or after the jump, zone-dependent) —
// acceptable for cron scheduling at 00:00/20:00, which never fall in a gap.
export function epochForLocal(
  dateStr: string,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, hour, minute);
  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    const p = localParts(guess, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - asUtc;
  }
  return guess;
}

// Ms from `now` until the next wall-clock `hour:minute` in `timeZone`.
// If `now` is at or past today's target, returns ms until tomorrow's.
export function nextLocalFireMs(
  now: Date,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const today = todayLocal(timeZone, now);
  let fire = epochForLocal(today, hour, minute, timeZone);
  if (fire <= now.getTime()) {
    fire = epochForLocal(addDays(today, 1), hour, minute, timeZone);
  }
  return fire - now.getTime();
}
