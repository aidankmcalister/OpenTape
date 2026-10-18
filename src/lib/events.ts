import { listen } from "@tauri-apps/api/event";

export const EVENTS = {
  pickerCursor: "picker-cursor",
  pickerSession: "picker-session",
  pickerClosed: "picker-closed",
  pickerKey: "picker-key",
  recordingStatus: "recording-status",
} as const;

/** Listens to a Tauri event and returns a cleanup function React effects can use directly. */
export function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
): () => void {
  const unlisten = listen<T>(event, ({ payload }) => handler(payload));
  return () => void unlisten.then((stop) => stop());
}
