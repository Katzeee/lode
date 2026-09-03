import { useEffect, useState } from "react";

import type { DesktopBridge } from "../bridge/contract.cjs";
import { DesktopDesignSystemPage } from "./design-system/design-system-page.js";
import { DesktopApp } from "./product/desktop-app.js";
import { DesktopLegalPage } from "./product/legal-page.js";
import { ToastProvider } from "./ui/toast.js";
import { TooltipProvider } from "./ui/tooltip.js";

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

  let content;
  if (surface === "design-system") {
    content = <DesktopDesignSystemPage />;
  } else if (surface === "legal") {
    content = <DesktopLegalPage />;
  } else {
    content = bridge === undefined ? <DesktopDesignSystemPage /> : <DesktopApp bridge={bridge} />;
  }
  return (
    <TooltipProvider>
      <ToastProvider>{content}</ToastProvider>
    </TooltipProvider>
  );
}
