import { useState } from "react";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { EVENTS } from "@/lib/events";
import type { Rect } from "@/lib/geometry";

type Framing = {
  isFraming: boolean;
  /** For a window recording, where the window sits on this display. */
  window: Rect | null;
};

/** Whether this overlay now frames a recording. Rust tells only that overlay. */
export function useFraming(): Framing {
  const [framing, setFraming] = useState<Framing>({
    isFraming: false,
    window: null,
  });
  useTauriEvent<Rect | null>(
    EVENTS.pickerRecording,
    (window) => setFraming({ isFraming: true, window }),
    "window",
  );
  return framing;
}
