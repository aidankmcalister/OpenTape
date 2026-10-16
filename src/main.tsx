import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/inter";
import "./index.css";
import RecordBar from "./components/RecordBar";
import Editor from "./components/Editor";

const label = getCurrentWindow().label;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {label === "editor" ? <Editor /> : <RecordBar />}
  </React.StrictMode>,
);
