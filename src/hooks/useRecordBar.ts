import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { quitApp, showRecordings } from "@/lib/app";
import { EVENTS, subscribe } from "@/lib/events";
import { popupActions } from "@/lib/menus";
import { closePicker, openPicker, type Mode } from "@/lib/picker";
import { startRecording, stopRecording, type Target } from "@/lib/recording";

export type Phase = "idle" | "starting" | "recording" | "stopping";

export type RecordBar = {
  /** The mode whose picker is open. */
  active: Mode | null;
  phase: Phase;
  elapsedMs: number;
  error: string;
  /** Opens or switches the picker, or closes it with null. */
  choose: (mode: Mode | null) => Promise<void>;
  stop: () => Promise<void>;
  dismissError: () => void;
  openSettings: (anchor: HTMLElement) => Promise<void>;
  quit: () => Promise<void>;
};

export function useRecordBar(): RecordBar {
  const [active, setActive] = useState<Mode | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const elapsedMs = useElapsedMs(phase === "recording");

  useEffect(() => {
    const stopPicked = subscribe<Target>(EVENTS.picked, (target) => {
      setActive(null);
      void record(target);
    });
    const stopClosed = subscribe(EVENTS.pickerClosed, () => setActive(null));
    return () => {
      stopPicked();
      stopClosed();
    };
  }, []);

  async function choose(mode: Mode | null) {
    setError("");
    try {
      if (mode) {
        await openPicker(mode);
        setActive(mode);
      } else {
        await closePicker();
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function record(target: Target) {
    setPhase("starting");
    try {
      await startRecording(target);
      setPhase("recording");
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  }

  async function stop() {
    setPhase("stopping");
    try {
      const saved = await stopRecording();
      await revealItemInDir(saved.videoPath);
    } catch (err) {
      setError(String(err));
    } finally {
      setPhase("idle");
    }
  }

  async function openSettings(anchor: HTMLElement) {
    await popupActions(anchor, [
      {
        label: "Show Recordings in Finder",
        run: () => void showRecordings().catch((err) => setError(String(err))),
      },
      "separator",
      { label: "Quit screen-recorder", run: () => void quitApp() },
    ]);
  }

  return {
    active,
    phase,
    elapsedMs,
    error,
    choose,
    stop,
    dismissError: () => setError(""),
    openSettings,
    quit: quitApp,
  };
}

function useElapsedMs(running: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => clearInterval(timer);
  }, [running]);
  return elapsedMs;
}
