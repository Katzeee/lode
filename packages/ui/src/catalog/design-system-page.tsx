import { findCatalogPage, overviewPage, type CatalogPage } from "@lode/design-system-catalog";
import { useEffect, useState, type ReactNode } from "react";

import { CatalogNavigation } from "./catalog-navigation.js";
import { CatalogModeContext, type CatalogMode, type ThemeName } from "./catalog-theme.js";
import { ButtonsPage, FormsPage, StatusPage, SurfacesPage } from "./component-pages.js";
import { ContentPage } from "./content-page.js";
import { ColorPage, GeometryPage, TypographyPage } from "./foundation-pages.js";
import { OverviewPage } from "./overview-page.js";
import { OverlaysPage } from "./overlays-page.js";
import { LayoutPage } from "./layout-page.js";
import { ProductPreviewPage } from "./product-preview.js";
import { ThemingPage } from "./theming-page.js";

function currentCatalogPath(): string {
  const route = window.location.hash.slice("#/design-system".length).split("?")[0] ?? "";
  return route.replace(/^\/+|\/+$/g, "");
}

function initialCatalogAppearance(): Readonly<{ mode: CatalogMode; theme: ThemeName }> {
  const query = window.location.hash.split("?")[1] ?? "";
  const parameters = new URLSearchParams(query);
  return {
    mode: parameters.get("mode") === "dark" ? "dark" : "light",
    theme: parameters.get("theme") === "slate" ? "slate" : "forest",
  };
}

export function DesignSystemPage({ productPreview }: Readonly<{ productPreview: ReactNode }>) {
  const [initialAppearance] = useState(initialCatalogAppearance);
  const [page, setPage] = useState(() => findCatalogPage(currentCatalogPath()) ?? overviewPage);
  const [mode, setMode] = useState<CatalogMode>(initialAppearance.mode);
  const [theme, setTheme] = useState<ThemeName>(initialAppearance.theme);

  useEffect(() => {
    const previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    window.scrollTo({ left: 0, top: 0 });
    const updatePage = () => {
      setPage(findCatalogPage(currentCatalogPath()) ?? overviewPage);
      window.scrollTo({ left: 0, top: 0 });
    };
    window.addEventListener("hashchange", updatePage);
    return () => {
      history.scrollRestoration = previousScrollRestoration;
      window.removeEventListener("hashchange", updatePage);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    document.documentElement.dataset.theme = theme;
    return () => {
      document.documentElement.dataset.mode = "light";
      delete document.documentElement.dataset.theme;
    };
  }, [mode, theme]);

  return (
    <CatalogModeContext.Provider value={mode}>
      <div
        className="lode-safe-area mx-auto flex min-h-screen w-full max-w-320 items-start gap-4 px-3 md:gap-10 md:px-10"
        data-ui="design-system"
      >
        <CatalogNavigation currentPage={page} mode={mode} onModeChange={setMode} />
        <main className="min-w-0 flex-1 py-6 md:py-10">
          <PageContent onThemeChange={setTheme} page={page} productPreview={productPreview} theme={theme} />
          <footer className="mt-16 border-t border-border pt-6 text-caption text-muted-foreground">
            Lode Design System — one token source, one component layer.
          </footer>
        </main>
      </div>
    </CatalogModeContext.Provider>
  );
}

function PageContent({
  onThemeChange,
  page,
  productPreview,
  theme,
}: Readonly<{
  onThemeChange(theme: ThemeName): void;
  page: CatalogPage;
  productPreview: ReactNode;
  theme: ThemeName;
}>) {
  switch (page.id) {
    case "overview": {
      return <OverviewPage />;
    }
    case "color": {
      return <ColorPage />;
    }
    case "theming": {
      return <ThemingPage onThemeChange={onThemeChange} theme={theme} />;
    }
    case "typography": {
      return <TypographyPage />;
    }
    case "content": {
      return <ContentPage />;
    }
    case "geometry": {
      return <GeometryPage />;
    }
    case "buttons": {
      return <ButtonsPage />;
    }
    case "forms": {
      return <FormsPage />;
    }
    case "overlays": {
      return <OverlaysPage />;
    }
    case "status": {
      return <StatusPage />;
    }
    case "surfaces": {
      return <SurfacesPage />;
    }
    case "layouts": {
      return <LayoutPage />;
    }
    case "product": {
      return <ProductPreviewPage>{productPreview}</ProductPreviewPage>;
    }
  }
}
