// Returns milliseconds from `now` until the next occurrence of `utcHour:utcMinute` UTC.
// If `now` is at or past today's target, returns ms until tomorrow's target.
export function nextFireMs(now: Date, utcHour: number, utcMinute: number): number {
  const next = new Date(now);
  next.setUTCHours(utcHour, utcMinute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}
