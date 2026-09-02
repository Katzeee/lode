import { findCatalogPage, overviewPage, type CatalogPage } from "@lode/design-system-catalog";
import { useEffect, useState } from "react";

import { CatalogNavigation } from "./catalog-navigation.js";
import { CatalogThemeContext, type AccentName, type CatalogTheme } from "./catalog-theme.js";
import { ButtonsPage, FormsPage, StatusPage, SurfacesPage } from "./component-pages.js";
import { ColorPage, GeometryPage, TypographyPage } from "./foundation-pages.js";
import { OverviewPage } from "./overview-page.js";
import { ProductPreviewPage } from "./product-preview.js";
import { ThemingPage } from "./theming-page.js";

function currentCatalogPath(): string {
  const route = window.location.hash.slice("#/design-system".length).split("?")[0] ?? "";
  return route.replace(/^\/+|\/+$/g, "");
}

export function DesktopDesignSystemPage() {
  const [page, setPage] = useState(() => findCatalogPage(currentCatalogPath()) ?? overviewPage);
  const [theme, setTheme] = useState<CatalogTheme>("light");
  const [accent, setAccent] = useState<AccentName>("forest");

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
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accent;
    return () => {
      document.documentElement.dataset.theme = "light";
      delete document.documentElement.dataset.accent;
    };
  }, [accent, theme]);

  return (
    <CatalogThemeContext.Provider value={theme}>
      <div className="mx-auto flex min-h-screen w-full max-w-320 items-start gap-4 px-3 md:gap-10 md:px-10">
        <CatalogNavigation currentPage={page} onThemeChange={setTheme} theme={theme} />
        <main className="min-w-0 flex-1 py-6 md:py-10">
          <PageContent accent={accent} onAccentChange={setAccent} page={page} />
          <footer className="mt-16 border-t border-border pt-6 text-caption text-muted-foreground">
            Lode Design System — one token source, one component layer.
          </footer>
        </main>
      </div>
    </CatalogThemeContext.Provider>
  );
}

function PageContent({
  accent,
  onAccentChange,
  page,
}: Readonly<{ accent: AccentName; onAccentChange(accent: AccentName): void; page: CatalogPage }>) {
  switch (page.id) {
    case "overview": {
      return <OverviewPage />;
    }
    case "color": {
      return <ColorPage />;
    }
    case "theming": {
      return <ThemingPage accent={accent} onAccentChange={onAccentChange} />;
    }
    case "typography": {
      return <TypographyPage />;
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
    case "status": {
      return <StatusPage />;
    }
    case "surfaces": {
      return <SurfacesPage />;
    }
    case "product": {
      return <ProductPreviewPage />;
    }
  }
}
