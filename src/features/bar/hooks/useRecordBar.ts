import { useCallback, useEffect, useRef, useState } from "react";
import { useOneAtATime } from "@/hooks/useOneAtATime";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { quitApp, shapeBar } from "@/features/bar/lib/bar";
import type { Animation } from "@/lib/bindings/Animation";
import type { Mode } from "@/lib/bindings/Mode";
import type { Phase } from "@/lib/bindings/Phase";
import type { RecordingStatus } from "@/lib/bindings/RecordingStatus";
import { EVENTS } from "@/lib/events";
import type { Size } from "@/lib/geometry";
import { popupActions } from "@/lib/menus";
import { closePicker, openPicker } from "@/features/picker/lib/picker";
import {
  pauseRecording,
  recordingStatus,
  restartRecording,
  stopRecording,
} from "@/features/recording/lib/recording";

export type RecordBar = {
  /** The mode whose picker is open. */
  active: Mode | null;
  phase: Phase;
  /** Read with `useElapsedMs`, so only the timer redraws as it counts. */
  timer: Timer;
  error: string | null;
  /** Opens or switches the picker, or closes it with null. */
  choose: (mode: Mode | null) => Promise<void>;
  togglePause: () => Promise<void>;
  /** Rust asks first, because restarting deletes what's been recorded. */
  restart: () => Promise<void>;
  stop: () => Promise<void>;
  dismissError: () => void;
  openSettings: (anchor: HTMLElement) => Promise<void>;
  quit: () => Promise<void>;
  /** Hears the pill's new size, so Rust's glass and click area follow it. */
  shape: (size: Size, animation: Animation | null) => void;
};

export function useRecordBar(): RecordBar {
  const [active, setActive] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRecordingStatus(setError);
  const { status } = timer;
  const oneAtATime = useOneAtATime();

  useTauriEvent(EVENTS.pickerClosed, () => setActive(null));

  /** Runs `job` unless another is still running, showing its error on the bar if it fails. */
  async function attempt(job: () => Promise<unknown>) {
    try {
      await oneAtATime(job);
    } catch (err) {
      setError(String(err));
    }
  }

  async function choose(mode: Mode | null) {
    setError(null);
    await attempt(async () => {
      if (mode) {
        await openPicker(mode);
        setActive(mode);
      } else {
        await closePicker();
      }
    });
  }

  async function openSettings(anchor: HTMLElement) {
    await oneAtATime(() =>
      popupActions(anchor, [{ label: "Quit screen-recorder", run: quit }]),
    ).catch(console.error);
  }

  return {
    active,
    phase: status.phase,
    timer,
    error,
    choose,
    togglePause: () => attempt(() => pauseRecording(status.phase !== "paused")),
    restart: () => attempt(restartRecording),
    stop: () => attempt(stopRecording),
    dismissError: () => setError(null),
    openSettings,
    quit,
    shape: (size, animation) =>
      void shapeBar(size.width, size.height, animation).catch(console.error),
  };
}

const quit = () => quitApp().catch(console.error);

/** A status from Rust, and when it arrived, so the timer can count on from it. */
type Timer = { status: RecordingStatus; receivedAt: number };

const IDLE: Timer = {
  status: { phase: "idle", error: null, elapsedMs: 0 },
  receivedAt: 0,
};

/** Follows Rust's recording status, passing any error to `onError`. */
function useRecordingStatus(onError: (message: string) => void): Timer {
  const [received, setReceived] = useState(IDLE);
  /** Whether an event has arrived, which is newer than what the first ask returns. */
  const hasEvent = useRef(false);
  const apply = useCallback(
    (status: RecordingStatus) => {
      setReceived({ status, receivedAt: Date.now() });
      if (status.error) onError(status.error);
    },
    [onError],
  );
  useEffect(() => {
    let isMounted = true;
    recordingStatus()
      .then((status) => {
        if (isMounted && !hasEvent.current) apply(status);
      })
      .catch(console.error);
    return () => {
      isMounted = false;
    };
  }, [apply]);
  useTauriEvent(EVENTS.recordingStatus, (status: RecordingStatus) => {
    hasEvent.current = true;
    apply(status);
  });
  return received;
}

/**
 * Counts on from Rust's recorded time while recording; holds still while paused. It ticks ten
 * times a second, so it belongs in the component that shows it, not the whole bar.
 */
export function useElapsedMs({ status, receivedAt }: Timer): number {
  const [now, setNow] = useState(receivedAt);
  const isRecording = status.phase === "recording";
  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [isRecording]);
  if (!isRecording) return status.elapsedMs;
  return status.elapsedMs + Math.max(now - receivedAt, 0);
}
