/** What Save or Copy is doing. Copied, Saved and Failed show briefly, then the actions return. */
export type Activity =
  "idle" | "saving" | "copying" | "copied" | "saved" | "failed";

type Job = "save" | "copy";

export type ActivityState = {
  activity: Activity;
  /** Why the last Save or Copy failed. */
  failure: string;
};

export type ActivityEvent =
  | { type: "start"; job: Job }
  | { type: "succeed"; job: Job }
  | { type: "fail"; error: string }
  /** A result has shown for long enough. */
  | { type: "expire" }
  /** Another recording is shown, or none. */
  | { type: "reset" };

export const IDLE_ACTIVITY: ActivityState = { activity: "idle", failure: "" };

const JOBS: Record<Job, { busy: Activity; done: Activity }> = {
  save: { busy: "saving", done: "saved" },
  copy: { busy: "copying", done: "copied" },
};

/** How long each result shows before the actions return. Busy and idle stay until changed. */
export const SHOWS_FOR_MS: Partial<Record<Activity, number>> = {
  copied: 2000,
  saved: 4000,
  failed: 5000,
};

export function nextActivity(
  state: ActivityState,
  event: ActivityEvent,
): ActivityState {
  switch (event.type) {
    case "start":
      return { ...state, activity: JOBS[event.job].busy };
    case "succeed":
      return { ...state, activity: JOBS[event.job].done };
    case "fail":
      return { activity: "failed", failure: event.error };
    case "expire":
      return SHOWS_FOR_MS[state.activity] === undefined
        ? state
        : { ...state, activity: "idle" };
    case "reset":
      return { ...state, activity: "idle" };
  }
}

/** How far through the clip `seconds` is, from 0 to 1, or 0 before its length is known. */
export function loopProgress(
  seconds: number,
  durationMs: number | null,
): number {
  return durationMs ? Math.min((seconds * 1000) / durationMs, 1) : 0;
}
