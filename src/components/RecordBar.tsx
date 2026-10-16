import { useState } from "react";
import {
  X,
  Monitor,
  AppWindow,
  SquareDashed,
  Mic,
  MicOff,
  Volume2,
  VolumeOff,
  Folder,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Mode = "display" | "window" | "area";

export default function RecordBar() {
  const [mode, setMode] = useState<Mode | "">("");
  const [microphone, setMicrophone] = useState(false);
  const [systemAudio, setSystemAudio] = useState(false);

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen items-center gap-1 rounded-2xl border bg-card px-2"
    >
      <Button variant="ghost" size="icon" aria-label="Close">
        <X />
      </Button>

      <Separator orientation="vertical" className="mx-1 my-3" />

      <ToggleGroup
        spacing={1}
        value={mode ? [mode] : []}
        onValueChange={(value) => setMode((value[0] ?? "") as Mode | "")}
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

      <Toggle size="lg" pressed={microphone} onPressedChange={setMicrophone}>
        {microphone ? (
          <Mic data-icon="inline-start" />
        ) : (
          <MicOff data-icon="inline-start" />
        )}
        {microphone ? "Microphone" : "No microphone"}
      </Toggle>
      <Toggle size="lg" pressed={systemAudio} onPressedChange={setSystemAudio}>
        {systemAudio ? (
          <Volume2 data-icon="inline-start" />
        ) : (
          <VolumeOff data-icon="inline-start" />
        )}
        {systemAudio ? "System audio" : "No system audio"}
      </Toggle>

      <Separator orientation="vertical" className="mx-1 my-3" />

      <Button variant="ghost" size="icon" aria-label="Recordings">
        <Folder />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Settings">
        <Settings />
      </Button>
    </div>
  );
}
