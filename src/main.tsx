import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/inter";
import "./index.css";
import Editor from "./components/Editor";
import RecordBar from "./components/RecordBar";
import Picker from "./components/picker/Picker";

const PICKER_PREFIX = "picker-";

function WindowContent({ label }: { label: string }) {
  if (label === "editor") return <Editor />;
  if (label.startsWith(PICKER_PREFIX)) {
    return <Picker displayId={Number(label.slice(PICKER_PREFIX.length))} />;
  }
  return <RecordBar />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WindowContent label={getCurrentWindow().label} />
  </React.StrictMode>,
);
