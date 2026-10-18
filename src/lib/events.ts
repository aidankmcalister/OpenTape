/** Every event Rust sends the pages, by name. */
export const EVENTS = {
  pickerCursor: "picker-cursor",
  pickerSession: "picker-session",
  pickerClosed: "picker-closed",
  pickerKey: "picker-key",
  pickerRecording: "picker-recording",
  recordingStatus: "recording-status",
  previewShow: "preview-show",
  previewPointer: "preview-pointer",
  previewKey: "preview-key",
  editorOpen: "editor-open",
  editorClosed: "editor-closed",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
