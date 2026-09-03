import type { IconName } from "@lode/design-system-catalog";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "./cn.js";
import { Icon } from "./icon.js";
import { Tooltip } from "./tooltip.js";

const activeClasses = "bg-accent text-accent-foreground";
const idleClasses = "text-muted-foreground hover:bg-accent/60 hover:text-foreground";

type NavItemProperties = ComponentPropsWithoutRef<"a"> & Readonly<{ active?: boolean; icon?: IconName }>;

export function NavItem({ active = false, children, className, icon, ...properties }: NavItemProperties) {
  return (
    <a
      {...properties}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-label font-medium transition-colors",
        active ? activeClasses : idleClasses,
        className,
      )}
    >
      {icon === undefined ? null : <Icon name={icon} size="sm" />}
      {children}
    </a>
  );
}

type NavRailItemProperties = ComponentPropsWithoutRef<"a"> &
  Readonly<{ active?: boolean; icon: IconName; label: string }>;

export function NavRailItem({ active = false, className, icon, label, ...properties }: NavRailItemProperties) {
  return (
    <Tooltip content={label}>
      <a
        {...properties}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        className={cn(
          "grid size-10 place-items-center rounded-md transition-colors",
          active ? activeClasses : idleClasses,
          className,
        )}
      >
        <Icon name={icon} />
      </a>
    </Tooltip>
  );
}

export function NavSectionLabel({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="mb-2 text-caption font-semibold tracking-widest text-muted-foreground uppercase">{children}</p>;
}
