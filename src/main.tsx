import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/newsreader/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";

import App from "./App";
import { initTheme } from "@/stores/theme";

// Reflect the persisted theme before the first paint (index.html does the
// same pre-paint; this attaches the system-preference listener).
initTheme();
document.addEventListener("contextmenu", (event) => event.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
