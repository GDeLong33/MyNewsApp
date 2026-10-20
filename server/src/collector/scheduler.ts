/** Milliseconds from `from` until the next top of the hour (UTC). */
export function msUntilNextHour(from: Date): number {
  const next = new Date(from);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime() - from.getTime();
}

/**
 * Call `task` at the top of every hour, inside the always-running server process.
 * Errors are logged, never thrown, so one bad run can't stop the schedule. Returns a stop function.
 */
export function startHourlySchedule(task: () => Promise<unknown>, now: () => Date = () => new Date()): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await task();
      } catch (err) {
        console.error("scheduled task failed", err);
      }
      scheduleNext();
    }, msUntilNextHour(now()));
  };

  scheduleNext();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
