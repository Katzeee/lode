import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { IconName } from "@lode/design-system-catalog";
import { tokens } from "@lode/design-tokens";
import { useState, type ReactNode } from "react";

import { Button } from "./button.js";
import { cn } from "./cn.js";
import { Icon } from "./icon.js";
import { NavItem, NavRailItem, NavSectionLabel } from "./nav.js";
import { Separator } from "./separator.js";
import { Tooltip } from "./tooltip.js";

export type AppShellItem = Readonly<{
  icon: IconName;
  id: string;
  label: string;
  target: string;
}>;

export type AppShellSection = Readonly<{
  id: string;
  items: readonly AppShellItem[];
  label?: string;
}>;

export type AppShellUtility = Readonly<{
  icon: IconName;
  id: string;
  label: string;
  onSelect?: () => void;
  target?: string;
}>;

type AppShellProperties = Readonly<{
  activeItemId: string;
  brand?: string;
  children: ReactNode;
  sections: readonly AppShellSection[];
  utilities?: readonly AppShellUtility[];
}>;

export function AppShell({ activeItemId, brand = "Lode", children, sections, utilities = [] }: AppShellProperties) {
  // A bottom bar only carries a handful of unlabeled, equally ranked
  // destinations; richer navigation graphs get a top bar with a modal drawer.
  const soleSection = sections.length === 1 ? sections[0] : undefined;
  const barItems = soleSection?.label === undefined ? soleSection?.items : undefined;
  const usesBar = barItems !== undefined && barItems.length <= 5 && utilities.length === 0;
  // People may prefer the icon rail even where the container affords the full
  // sidebar; the preference never overrides what narrow containers mandate.
  const [railPreferred, setRailPreferred] = useState(false);
  return (
    <div className="lode-safe-area @container/app-shell flex min-h-screen flex-col bg-background" data-ui="app-shell">
      {usesBar ? null : (
        <CompactDrawerBar activeItemId={activeItemId} brand={brand} sections={sections} utilities={utilities} />
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        <MediumRail
          activeItemId={activeItemId}
          brand={brand}
          onExpand={() => setRailPreferred(false)}
          railPreferred={railPreferred}
          sections={sections}
          utilities={utilities}
        />
        <ExpandedSidebar
          activeItemId={activeItemId}
          brand={brand}
          onCollapse={() => setRailPreferred(true)}
          railPreferred={railPreferred}
          sections={sections}
          utilities={utilities}
        />
        <div className="min-w-0 flex-1">{children}</div>
      </div>

      {usesBar ? <CompactBottomBar activeItemId={activeItemId} items={barItems} /> : null}
    </div>
  );
}

type TierProperties = Readonly<{
  activeItemId: string;
  brand: string;
  sections: readonly AppShellSection[];
  utilities: readonly AppShellUtility[];
}>;

function CompactBottomBar({ activeItemId, items }: Readonly<{ activeItemId: string; items: readonly AppShellItem[] }>) {
  return (
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
  );
}

function CompactDrawerBar({ activeItemId, brand, sections, utilities }: TierProperties) {
  const [open, setOpen] = useState(false);
  return (
    <header
      className="flex items-center gap-2.5 border-b border-border bg-card px-2 py-2 @shell-medium/app-shell:hidden"
      data-layout="compact"
    >
      <BaseDialog.Root onOpenChange={setOpen} open={open}>
        <BaseDialog.Trigger render={<Button aria-label="Open navigation" size="icon" variant="ghost" />}>
          <Icon name="menu" />
        </BaseDialog.Trigger>
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="lode-overlay-backdrop fixed inset-0 min-h-dvh bg-foreground/35" />
          <BaseDialog.Popup
            aria-label={`${brand} navigation`}
            className="lode-overlay-drawer fixed inset-y-0 left-0 flex min-h-dvh w-72 max-w-full flex-col overflow-y-auto border-r border-border bg-card px-4 py-5 shadow-lg outline-none"
          >
            <span className="flex items-center gap-2.5 font-bold tracking-tight">
              <BrandMark label={brand} />
              <span className="min-w-0 truncate">{brand}</span>
            </span>
            <SectionedNav
              activeItemId={activeItemId}
              onNavigate={() => setOpen(false)}
              sections={sections}
              utilities={utilities}
            />
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      </BaseDialog.Root>
      <span className="flex min-w-0 items-center gap-2 font-bold tracking-tight">
        <span className="truncate">{brand}</span>
      </span>
    </header>
  );
}

function MediumRail({
  activeItemId,
  brand,
  onExpand,
  railPreferred,
  sections,
  utilities,
}: TierProperties & Readonly<{ onExpand: () => void; railPreferred: boolean }>) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen w-18 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-border bg-card py-5 @shell-medium/app-shell:flex",
        railPreferred ? undefined : "@shell-expanded/app-shell:hidden",
      )}
      data-layout="medium"
    >
      <BrandMark label={brand} />
      <Tooltip content="Expand navigation">
        <Button
          aria-label="Expand navigation"
          className="hidden @shell-expanded/app-shell:inline-flex"
          onClick={onExpand}
          size="icon"
          variant="ghost"
        >
          <Icon name="panel-left-open" />
        </Button>
      </Tooltip>
      <nav aria-label="Primary" className="mt-3 flex w-full flex-col items-center gap-1">
        {sections.map((section, index) => (
          <div
            aria-label={section.label}
            className="flex w-full flex-col items-center gap-1"
            key={section.id}
            role={section.label === undefined ? undefined : "group"}
          >
            {index === 0 ? null : <Separator className="mx-auto my-2 w-8" />}
            {section.items.map((item) => (
              <NavRailItem
                active={item.id === activeItemId}
                href={item.target}
                icon={item.icon}
                key={item.id}
                label={item.label}
              />
            ))}
          </div>
        ))}
      </nav>
      {utilities.length === 0 ? null : (
        <div className="mt-auto flex flex-col items-center gap-1 pt-4">
          {utilities.map((utility) =>
            utility.target === undefined ? (
              <Tooltip content={utility.label} key={utility.id}>
                <Button aria-label={utility.label} onClick={utility.onSelect} size="icon" variant="ghost">
                  <Icon name={utility.icon} />
                </Button>
              </Tooltip>
            ) : (
              <NavRailItem href={utility.target} icon={utility.icon} key={utility.id} label={utility.label} />
            ),
          )}
        </div>
      )}
    </aside>
  );
}

function ExpandedSidebar({
  activeItemId,
  brand,
  onCollapse,
  railPreferred,
  sections,
  utilities,
}: TierProperties & Readonly<{ onCollapse: () => void; railPreferred: boolean }>) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-border bg-card px-4 py-5",
        railPreferred ? undefined : "@shell-expanded/app-shell:flex",
      )}
      data-layout="expanded"
      style={{ width: tokens.layout.navigation.rail }}
    >
      <div className="flex items-center gap-1">
        <a className="flex min-w-0 flex-1 items-center gap-2.5 font-bold tracking-tight" href="#/">
          <BrandMark label={brand} />
          <span className="min-w-0 truncate">{brand}</span>
        </a>
        <Tooltip content="Collapse navigation">
          <Button aria-label="Collapse navigation" className="size-8" onClick={onCollapse} size="icon" variant="ghost">
            <Icon name="panel-left-close" size="sm" />
          </Button>
        </Tooltip>
      </div>
      <SectionedNav activeItemId={activeItemId} sections={sections} utilities={utilities} />
    </aside>
  );
}

function SectionedNav({
  activeItemId,
  onNavigate,
  sections,
  utilities,
}: Readonly<{
  activeItemId: string;
  onNavigate?: () => void;
  sections: readonly AppShellSection[];
  utilities: readonly AppShellUtility[];
}>) {
  return (
    <>
      <nav aria-label="Primary" className="mt-8 flex flex-col gap-6">
        {sections.map((section) => (
          <div key={section.id}>
            {section.label === undefined ? null : <NavSectionLabel>{section.label}</NavSectionLabel>}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <NavItem
                  active={item.id === activeItemId}
                  href={item.target}
                  icon={item.icon}
                  key={item.id}
                  onClick={onNavigate}
                >
                  {item.label}
                </NavItem>
              ))}
            </div>
          </div>
        ))}
      </nav>
      {utilities.length === 0 ? null : (
        <div className="mt-auto flex flex-col gap-0.5 pt-6">
          {utilities.map((utility) =>
            utility.target === undefined ? (
              <Button
                className="justify-start px-2.5 font-medium"
                key={utility.id}
                onClick={() => {
                  utility.onSelect?.();
                  onNavigate?.();
                }}
                size="sm"
                variant="ghost"
              >
                <Icon name={utility.icon} size="sm" />
                {utility.label}
              </Button>
            ) : (
              <NavItem href={utility.target} icon={utility.icon} key={utility.id} onClick={onNavigate}>
                {utility.label}
              </NavItem>
            ),
          )}
        </div>
      )}
    </>
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
