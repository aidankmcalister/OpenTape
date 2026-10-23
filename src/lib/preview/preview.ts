export type Activity =
  "idle" | "saving" | "copying" | "copied" | "saved" | "failed";

type Job = "save" | "copy";

export type ActivityState = {
  activity: Activity;
  failure: string;
};

export type ActivityEvent =
  | { type: "start"; job: Job }
  | { type: "succeed"; job: Job }
  | { type: "fail"; error: string }
  | { type: "expire" }
  | { type: "reset" };

export const IDLE_ACTIVITY: ActivityState = { activity: "idle", failure: "" };

const JOBS: Record<Job, { busy: Activity; done: Activity }> = {
  save: { busy: "saving", done: "saved" },
  copy: { busy: "copying", done: "copied" },
};

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

export function loopProgress(
  seconds: number,
  durationMs: number | null,
): number {
  return durationMs ? Math.min((seconds * 1000) / durationMs, 1) : 0;
}
