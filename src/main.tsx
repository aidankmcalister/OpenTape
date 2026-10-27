import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";
import RecordBar from "@/pages/RecordBar";
import { TooltipProvider } from "@/components/ui/tooltip";
import Editor from "@/pages/Editor";
import Picker from "@/pages/Picker";
import RecordingPreview from "@/pages/RecordingPreview";

function WindowContent({ label }: { label: string }) {
  if (label === "editor") return <Editor />;
  if (label === "preview") return <RecordingPreview />;
  if (label.startsWith("picker-")) {
    return <Picker displayId={Number(label.slice("picker-".length))} />;
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
