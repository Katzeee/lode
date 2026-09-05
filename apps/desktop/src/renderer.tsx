import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LodeApp, connectApplication, type ApplicationConnection } from "@lode/application";
import { createWebConnection } from "./renderer/web-connection.js";

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("Lode renderer root is missing");
}
const connection = (window as unknown as { lode?: ApplicationConnection }).lode ?? createWebConnection();
const host = connectApplication(connection);
createRoot(root).render(
  <StrictMode>
    <LodeApp host={host} />
  </StrictMode>,
);
