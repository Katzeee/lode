import { tokens } from "@lode/design-tokens";
import type { IconName } from "@lode/design-system-catalog";
import type { ReactNode } from "react";

import { Icon } from "./icon.js";
import { NavItem, NavRailItem } from "./nav.js";

export type AppShellItem = Readonly<{
  icon: IconName;
  id: string;
  label: string;
  target: string;
}>;

export function AppShell({
  activeItemId,
  brand = "Lode",
  children,
  items,
}: Readonly<{
  activeItemId: string;
  brand?: string;
  children: ReactNode;
  items: readonly AppShellItem[];
}>) {
  return (
    <div className="@container/app-shell grid min-h-screen grid-rows-[1fr_auto] bg-background" data-ui="app-shell">
      <div className="flex min-w-0">
        <aside
          className="hidden w-18 shrink-0 flex-col items-center gap-2 border-r border-border bg-card py-5 @shell-medium/app-shell:flex @shell-expanded/app-shell:hidden"
          data-layout="medium"
        >
          <BrandMark label={brand} />
          <nav aria-label="Primary" className="mt-5 flex flex-col gap-1">
            {items.map((item) => (
              <NavRailItem
                active={item.id === activeItemId}
                href={item.target}
                icon={item.icon}
                key={item.id}
                label={item.label}
              />
            ))}
          </nav>
        </aside>

        <aside
          className="hidden shrink-0 flex-col border-r border-border bg-card px-4 py-5 @shell-expanded/app-shell:flex"
          data-layout="expanded"
          style={{ width: tokens.layout.navigation.rail }}
        >
          <a className="flex items-center gap-2.5 font-bold tracking-tight" href="#/">
            <BrandMark label={brand} />
            {brand}
          </a>
          <nav aria-label="Primary" className="mt-8 flex flex-col gap-1">
            {items.map((item) => (
              <NavItem active={item.id === activeItemId} href={item.target} icon={item.icon} key={item.id}>
                {item.label}
              </NavItem>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>

      <nav
        aria-label="Primary"
        className="grid border-t border-border bg-card p-2 @shell-medium/app-shell:hidden"
        data-layout="compact"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => (
          <a
            aria-current={item.id === activeItemId ? "page" : undefined}
            className="flex min-w-0 flex-col items-center gap-1 rounded-sm px-1 py-2 text-caption font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
            href={item.target}
            key={item.id}
          >
            <Icon name={item.icon} size="sm" />
            <span className="truncate">{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

function BrandMark({ label }: Readonly<{ label: string }>) {
  return (
    <span
      aria-label={label}
      className="grid size-8 shrink-0 place-items-center rounded-sm bg-primary text-label font-bold text-primary-foreground"
      role="img"
    >
      L
    </span>
  );
}
