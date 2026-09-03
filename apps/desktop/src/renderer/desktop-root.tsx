import { DesignSystemPage } from "@lode/ui/catalog";
import { LegalPage, ToastProvider, TooltipProvider } from "@lode/ui";
import { useEffect, useState } from "react";

import type { DesktopBridge } from "../bridge/contract.cjs";
import { DesktopApp } from "./product/desktop-app.js";
import { DesktopProductPreview } from "./product/desktop-product-preview.js";

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
    content = <DesignSystemPage productPreview={<DesktopProductPreview />} />;
  } else if (surface === "legal") {
    content = <LegalPage />;
  } else {
    content =
      bridge === undefined ? (
        <DesignSystemPage productPreview={<DesktopProductPreview />} />
      ) : (
        <DesktopApp bridge={bridge} />
      );
  }
  return (
    <TooltipProvider>
      <ToastProvider>{content}</ToastProvider>
    </TooltipProvider>
  );
}
