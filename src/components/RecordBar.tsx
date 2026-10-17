import { useEffect, useState } from "react";
import { AppWindow, Circle, Monitor, Square, SquareDashed } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatTime } from "@/lib/time";
import {
  choicesFor,
  listSources,
  startRecording,
  stopRecording,
  targetFor,
  type Mode,
  type Sources,
} from "@/lib/recording";

type Phase = "idle" | "starting" | "recording" | "stopping";

export default function RecordBar() {
  const [mode, setMode] = useState<Mode | "">("");
  const [sources, setSources] = useState<Sources | null>(null);
  const [choiceId, setChoiceId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  const choices = mode && sources ? choicesFor(mode, sources) : [];

  // Refresh what can be recorded whenever the mode changes.
  useEffect(() => {
    if (!mode) return;
    setError("");
    listSources()
      .then((found) => {
        setSources(found);
        setChoiceId(choicesFor(mode, found)[0]?.id ?? null);
      })
      .catch((err) => setError(String(err)));
  }, [mode]);

  // Tick the timer while recording.
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(timer);
  }, [phase, startedAt]);

  async function record() {
    if (!mode || !sources || choiceId === null) return;
    const target = targetFor(mode, choiceId, sources);
    if (!target) return;
    setError("");
    setPhase("starting");
    try {
      await startRecording(target);
      setStartedAt(Date.now());
      setElapsed(0);
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

  const busy = phase !== "idle";

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen items-center gap-1 rounded-2xl border bg-card px-2"
    >
      <ToggleGroup
        spacing={1}
        value={mode ? [mode] : []}
        onValueChange={(value) => setMode((value[0] ?? "") as Mode | "")}
        disabled={busy}
      >
        <ToggleGroupItem value="display" className="h-12 w-16 flex-col">
          <Monitor />
          <span className="text-xs">Display</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="window" className="h-12 w-16 flex-col">
          <AppWindow />
          <span className="text-xs">Window</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="area" className="h-12 w-16 flex-col">
          <SquareDashed />
          <span className="text-xs">Area</span>
        </ToggleGroupItem>
      </ToggleGroup>

      <Separator orientation="vertical" className="mx-1 my-3" />

      <div className="min-w-0 flex-1">
        {error ? (
          <p className="truncate text-xs text-destructive" title={error}>
            {error}
          </p>
        ) : (
          <NativeSelect
            className="w-full"
            value={choiceId ?? ""}
            onChange={(event) => setChoiceId(Number(event.target.value))}
            disabled={!mode || busy || choices.length === 0}
            aria-label="What to record"
          >
            {!mode && (
              <NativeSelectOption value="">
                Choose Display, Window or Area
              </NativeSelectOption>
            )}
            {choices.map((choice) => (
              <NativeSelectOption key={choice.id} value={choice.id}>
                {choice.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </div>

      <Separator orientation="vertical" className="mx-1 my-3" />

      {phase === "recording" || phase === "stopping" ? (
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums">{formatTime(elapsed)}</span>
          <Button
            variant="outline"
            onClick={stop}
            disabled={phase === "stopping"}
          >
            <Square data-icon="inline-start" />
            Stop
          </Button>
        </div>
      ) : (
        <Button
          variant="destructive"
          onClick={record}
          disabled={!mode || choiceId === null || phase === "starting"}
        >
          <Circle data-icon="inline-start" />
          Record
        </Button>
      )}
    </div>
  );
}
