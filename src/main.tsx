import "./App.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initWorkspaceStore } from "./store/workspaceStore";

function render() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

initWorkspaceStore().then(render).catch((e) => {
  console.error("Failed to init workspace store:", e);
  render(); // render with defaults on failure
});
