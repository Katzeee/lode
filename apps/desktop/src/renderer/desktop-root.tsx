import { useEffect, useState } from "react";

import type { DesktopBridge } from "../bridge/contract.cjs";
import { DesktopDesignSystemPage } from "./design-system/design-system-page.js";
import { DesktopApp } from "./product/desktop-app.js";
import { DesktopLegalPage } from "./product/legal-page.js";

type DesktopSurface = "design-system" | "legal" | "product";

function currentSurface(): DesktopSurface {
  if (window.location.hash.startsWith("#/design-system")) {
    return "design-system";
  }
  if (window.location.hash === "#/legal") {
    return "legal";
  }
  return "product";
}

export function DesktopRoot({ bridge }: Readonly<{ bridge?: DesktopBridge }>) {
  const [surface, setSurface] = useState(currentSurface);

  useEffect(() => {
    const updateRoute = () => setSurface(currentSurface());
    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  if (surface === "design-system") {
    return <DesktopDesignSystemPage />;
  }
  if (surface === "legal") {
    return <DesktopLegalPage />;
  }
  return bridge === undefined ? <DesktopDesignSystemPage /> : <DesktopApp bridge={bridge} />;
}
