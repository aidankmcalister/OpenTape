import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/space-grotesk";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./index.css";
import { TooltipProvider } from "@/components/ui/tooltip";

// Each window loads only its own page, so the bar and pickers skip the editor's code.
const Editor = lazy(() => import("@/pages/Editor"));
const Permissions = lazy(() => import("@/pages/Permissions"));
const Picker = lazy(() => import("@/pages/Picker"));
const RecordBar = lazy(() => import("@/pages/RecordBar"));
const RecordingPreview = lazy(() => import("@/pages/RecordingPreview"));
const Settings = lazy(() => import("@/pages/Settings"));

function WindowContent({ label }: { label: string }) {
  if (label === "editor") return <Editor />;
  if (label === "preview") return <RecordingPreview />;
  if (label === "settings") return <Settings />;
  if (label === "permissions") return <Permissions />;
  if (label.startsWith("picker-")) {
    return <Picker displayId={Number(label.slice("picker-".length))} />;
  }
  return <RecordBar />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <Suspense>
        <WindowContent label={getCurrentWindow().label} />
      </Suspense>
    </TooltipProvider>
  </React.StrictMode>,
);
