import { useState } from "react";
import { oneAtATime, type OneAtATime } from "@/lib/oneAtATime";

/** A gate for this component's actions, so a double click or repeated key runs each once. */
export function useOneAtATime(): OneAtATime {
  const [run] = useState(oneAtATime);
  return run;
}
