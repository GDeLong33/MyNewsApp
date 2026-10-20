/** Articles are kept for 168 hours after their publication time. */
export const RETENTION_HOURS = 168;
export const RETENTION_MS = RETENTION_HOURS * 60 * 60 * 1000;

/** ISO timestamp before which an article is expired. Stored timestamps are ISO UTC, so they compare as strings. */
export function retentionCutoffIso(now: Date): string {
  return new Date(now.getTime() - RETENTION_MS).toISOString();
}
