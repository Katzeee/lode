import { LegalPage, Spinner, ToastProvider, TooltipProvider } from "@lode/ui";
import { lazy, Suspense, useEffect, useState } from "react";

import type { DesktopBridge } from "../bridge/contract.cjs";
import { DesktopApp } from "./product/desktop-app.js";
import { DesktopProductPreview } from "./product/desktop-product-preview.js";

// The catalog is a review surface most sessions never open; it stays out of
// the product's startup bundle and loads on demand.
const DesignSystemPage = lazy(async () => {
  const { DesignSystemPage: page } = await import("@lode/ui/catalog");
  return { default: page };
});

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
      <ToastProvider>
        <Suspense fallback={<SurfaceLoading />}>{content}</Suspense>
      </ToastProvider>
    </TooltipProvider>
  );
}

function SurfaceLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <Spinner className="text-primary" label="Loading" />
    </div>
  );
}
