// Gemini's free-tier daily limits reset at midnight Pacific time, so the server's own daily AI budget
// is counted over the same day.

export const QUOTA_TIME_ZONE = "America/Los_Angeles";

/** The instant the current quota day began (midnight in QUOTA_TIME_ZONE), as a UTC Date. */
export function startOfQuotaDay(now: Date, timeZone = QUOTA_TIME_ZONE): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wallClockAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = wallClockAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")) - offsetMs);
}
