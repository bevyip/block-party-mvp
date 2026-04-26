import React from "react";
import ReactDOM from "react-dom/client";
import { SpritesPage } from "./page";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <SpritesPage />
  </React.StrictMode>,
);
