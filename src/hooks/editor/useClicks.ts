import { useState } from "react";
import { useInvokeOnMount } from "@/hooks/useTauri";
import type { CursorLog } from "@/lib/bindings";
import { type CursorClick, readClicks } from "@/lib/editor/cursor";

export function useClicks(): CursorClick[] {
  const [clicks, setClicks] = useState<CursorClick[]>([]);
  useInvokeOnMount<CursorLog | null>("cursor_log", (log) => {
    if (log) setClicks(readClicks(log.meta, log.events));
  });
  return clicks;
}
