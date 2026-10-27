import React from "react";
import ReactDOM from "react-dom/client";
import { IconDefs } from "./icons";
import MainWindow from "./main-window/MainWindow";
import ProgressWindow from "./windows/ProgressWindow";
import CompleteWindow from "./windows/CompleteWindow";
import AddWindow from "./windows/AddWindow";
import "./styles.css";

declare global {
  interface Window {
    __SWG_ROUTE?: string;
  }
}

// Secondary windows get their route injected by the backend before the page loads.
const [view, param] = (window.__SWG_ROUTE ?? "main").split("/");

function Root() {
  switch (view) {
    case "progress":
      return <ProgressWindow id={Number(param)} />;
    case "complete":
      return <CompleteWindow id={Number(param)} />;
    case "add":
      return <AddWindow token={param} />;
    default:
      return <MainWindow />;
  }
}

// Behave like a desktop app: no browser context menu, reload or zoom.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("input, textarea")) e.preventDefault();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "F5" || (e.ctrlKey && ["r", "R", "p", "P", "+", "-", "="].includes(e.key))) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IconDefs />
    <Root />
  </React.StrictMode>,
);
