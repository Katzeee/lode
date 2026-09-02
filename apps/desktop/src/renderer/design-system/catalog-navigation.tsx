import { catalogSections, overviewPage, type CatalogPage, type CatalogPageId } from "@lode/design-system-catalog";
import {
  AppWindow,
  CircleAlert,
  House,
  Layers,
  Moon,
  MousePointerClick,
  Palette,
  Shapes,
  Sun,
  SunMoon,
  TextCursorInput,
  Type,
  type LucideIcon,
} from "lucide-react";

import { Button } from "../ui/button.js";
import { NavItem, NavRailItem, NavSectionLabel } from "../ui/nav.js";
import { Separator } from "../ui/separator.js";
import type { CatalogTheme } from "./catalog-theme.js";

const pageIcons: Readonly<Record<CatalogPageId, LucideIcon>> = {
  overview: House,
  color: Palette,
  theming: SunMoon,
  typography: Type,
  geometry: Shapes,
  buttons: MousePointerClick,
  forms: TextCursorInput,
  status: CircleAlert,
  surfaces: Layers,
  product: AppWindow,
};

function pageHref(page: CatalogPage): string {
  return `#/design-system/${page.path}`;
}

type NavigationProperties = Readonly<{
  currentPage: CatalogPage;
  onThemeChange(theme: CatalogTheme): void;
  theme: CatalogTheme;
}>;

export function CatalogNavigation(properties: NavigationProperties) {
  return (
    <>
      <DockNavigation {...properties} />
      <SidebarNavigation {...properties} />
    </>
  );
}

function SidebarNavigation({ currentPage, onThemeChange, theme }: NavigationProperties) {
  return (
    <aside className="sticky top-0 hidden max-h-screen w-63 shrink-0 flex-col gap-6 overflow-y-auto py-10 md:flex">
      <header className="flex min-w-0 items-center gap-2.5">
        <WordmarkLink />
        <div className="min-w-0">
          <p className="truncate text-label font-bold tracking-tight">Lode Design System</p>
          <a className="text-caption text-muted-foreground hover:text-accent-foreground" href="#/">
            ← Return to Lode
          </a>
        </div>
      </header>

      <Button
        className="justify-start"
        onClick={() => onThemeChange(theme === "light" ? "dark" : "light")}
        size="sm"
        variant="outline"
      >
        {theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      </Button>

      <nav className="flex flex-col gap-6">
        <NavItem
          active={currentPage.id === overviewPage.id}
          href={pageHref(overviewPage)}
          icon={pageIcons[overviewPage.id]}
        >
          {overviewPage.title}
        </NavItem>
        {catalogSections.map((section) => (
          <div key={section.id}>
            <NavSectionLabel>{section.title}</NavSectionLabel>
            <div className="flex flex-col gap-0.5">
              {section.pages.map((page) => (
                <NavItem
                  active={currentPage.id === page.id}
                  href={pageHref(page)}
                  icon={pageIcons[page.id]}
                  key={page.id}
                >
                  {page.title}
                </NavItem>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function DockNavigation({ currentPage, onThemeChange, theme }: NavigationProperties) {
  const ThemeIcon = theme === "light" ? Moon : Sun;
  const themeLabel = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  return (
    <aside className="sticky top-0 flex max-h-screen w-13 shrink-0 flex-col items-center gap-3 overflow-y-auto py-4 md:hidden">
      <WordmarkLink />
      <nav aria-label="Catalog pages" className="flex w-10 flex-col items-center gap-3">
        <NavRailItem
          active={currentPage.id === overviewPage.id}
          href={pageHref(overviewPage)}
          icon={pageIcons[overviewPage.id]}
          label={overviewPage.title}
        />
        {catalogSections.map((section) => (
          <div
            aria-label={section.title}
            className="flex w-full flex-col items-center gap-1"
            key={section.id}
            role="group"
          >
            <Separator className="mb-2" />
            {section.pages.map((page) => (
              <NavRailItem
                active={currentPage.id === page.id}
                href={pageHref(page)}
                icon={pageIcons[page.id]}
                key={page.id}
                label={page.title}
              />
            ))}
          </div>
        ))}
      </nav>
      <Button
        aria-label={themeLabel}
        className="mt-auto"
        onClick={() => onThemeChange(theme === "light" ? "dark" : "light")}
        size="icon"
        title={themeLabel}
        variant="ghost"
      >
        <ThemeIcon aria-hidden="true" className="size-4.5" />
      </Button>
    </aside>
  );
}

function WordmarkLink() {
  return (
    <a
      aria-label="Return to Lode"
      className="grid size-8 shrink-0 place-items-center rounded-sm bg-primary text-label font-bold text-primary-foreground"
      href="#/"
    >
      L
    </a>
  );
}
