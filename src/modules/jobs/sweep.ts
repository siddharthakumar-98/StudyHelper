import type { JobSnapshot } from "./types";

/**
 * The cron sweep starts a new step only this long after it began (item 15). Any
 * step may run for up to about 280 s (a 270 s AI call, R14, plus its reads and
 * writes), and the route is killed at 300 s (maxDuration): a step started later
 * than 20 s in could be cut off mid-way, which counts an attempt for nothing.
 * Quick steps (splitting, the step after a split batch, a resumed job that is
 * done) still run back to back inside the window.
 */
export const CRON_START_WINDOW_MS = 20_000;

/**
 * Steps unfinished jobs, oldest first, following each finished job into its
 * successor, while the start window is open. A job locked by a browser tab (not
 * run) or one that just failed a step is left for later. Returns how many steps ran.
 */
export async function sweepJobs(
  jobIds: string[],
  runStep: (id: string) => Promise<{ snapshot: JobSnapshot; ran: boolean }>,
  now: () => number = Date.now,
): Promise<number> {
  const startedAt = now();
  const canStart = () => now() - startedAt < CRON_START_WINDOW_MS;
  let steps = 0;
  for (const id of jobIds) {
    let nextId: string | null = id;
    while (nextId && canStart()) {
      const { snapshot, ran } = await runStep(nextId);
      if (!ran) break; // locked by a browser tab, or finished elsewhere
      steps += 1;
      if (snapshot.status === "done") {
        nextId = snapshot.nextJobId;
      } else if (snapshot.status === "failed" || snapshot.error) {
        break; // leave a flaky job for the next sweep rather than hammering it
      }
    }
    if (!canStart()) break;
  }
  return steps;
}
