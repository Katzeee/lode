import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { DesktopBridge } from "./bridge/contract.cjs";
import { DesktopRoot } from "./renderer/desktop-root.js";

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("Lode renderer root is missing");
}
const desktopWindow = window as unknown as Window & Readonly<{ lode?: DesktopBridge }>;

createRoot(root).render(
  <StrictMode>
    <DesktopRoot bridge={desktopWindow.lode} />
  </StrictMode>,
);
