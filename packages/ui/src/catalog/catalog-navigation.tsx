import { catalogPageIcons, catalogSections, overviewPage, type CatalogPage } from "@lode/design-system-catalog";

import { Button } from "../components/button.js";
import { Icon } from "../components/icon.js";
import { NavItem, NavRailItem, NavSectionLabel } from "../components/nav.js";
import { Separator } from "../components/separator.js";
import { Tooltip } from "../components/tooltip.js";
import type { CatalogMode } from "./catalog-theme.js";

function pageHref(page: CatalogPage): string {
  return `#/design-system/${page.path}`;
}

type NavigationProperties = Readonly<{
  currentPage: CatalogPage;
  onModeChange(mode: CatalogMode): void;
  mode: CatalogMode;
}>;

export function CatalogNavigation(properties: NavigationProperties) {
  return (
    <>
      <DockNavigation {...properties} />
      <SidebarNavigation {...properties} />
    </>
  );
}

function SidebarNavigation({ currentPage, mode, onModeChange }: NavigationProperties) {
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
        className="justify-start px-2.5 font-medium"
        onClick={() => onModeChange(mode === "light" ? "dark" : "light")}
        size="sm"
        variant="ghost"
      >
        <Icon name={mode === "light" ? "moon" : "sun"} size="sm" />
        {mode === "light" ? "Switch to dark mode" : "Switch to light mode"}
      </Button>

      <nav className="flex flex-col gap-6">
        <NavItem
          active={currentPage.id === overviewPage.id}
          href={pageHref(overviewPage)}
          icon={catalogPageIcons[overviewPage.id]}
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
                  icon={catalogPageIcons[page.id]}
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

function DockNavigation({ currentPage, mode, onModeChange }: NavigationProperties) {
  const themeIcon = mode === "light" ? "moon" : "sun";
  const themeLabel = mode === "light" ? "Switch to dark mode" : "Switch to light mode";
  return (
    <aside className="sticky top-0 flex max-h-screen w-13 shrink-0 flex-col items-center gap-3 overflow-y-auto py-4 md:hidden">
      <WordmarkLink />
      <nav aria-label="Catalog pages" className="flex w-10 flex-col items-center gap-3">
        <NavRailItem
          active={currentPage.id === overviewPage.id}
          href={pageHref(overviewPage)}
          icon={catalogPageIcons[overviewPage.id]}
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
                icon={catalogPageIcons[page.id]}
                key={page.id}
                label={page.title}
              />
            ))}
          </div>
        ))}
      </nav>
      <Tooltip content={themeLabel}>
        <Button
          aria-label={themeLabel}
          className="mt-auto"
          onClick={() => onModeChange(mode === "light" ? "dark" : "light")}
          size="icon"
          variant="ghost"
        >
          <Icon name={themeIcon} />
        </Button>
      </Tooltip>
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
