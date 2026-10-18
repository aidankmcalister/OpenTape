import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";
import Editor from "./components/editor/Editor";
import RecordBar from "./components/RecordBar";
import Picker from "./components/picker/Picker";
import RecordingPreview from "./components/RecordingPreview";
import { TooltipProvider } from "./components/ui/tooltip";

const PICKER_PREFIX = "picker-";

function WindowContent({ label }: { label: string }) {
  if (label === "editor") return <Editor />;
  if (label === "preview") return <RecordingPreview />;
  if (label.startsWith(PICKER_PREFIX)) {
    return <Picker displayId={Number(label.slice(PICKER_PREFIX.length))} />;
  }
  return <RecordBar />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <WindowContent label={getCurrentWindow().label} />
    </TooltipProvider>
  </React.StrictMode>,
);
