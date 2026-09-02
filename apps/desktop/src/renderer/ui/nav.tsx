import type { LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "./cn.js";

const activeClasses = "bg-accent text-accent-foreground";
const idleClasses = "text-muted-foreground hover:bg-accent/60 hover:text-foreground";

type NavItemProperties = ComponentPropsWithoutRef<"a"> & Readonly<{ active?: boolean; icon?: LucideIcon }>;

export function NavItem({ active = false, children, className, icon: Icon, ...properties }: NavItemProperties) {
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
      {Icon === undefined ? null : <Icon aria-hidden="true" className="size-4 shrink-0" />}
      {children}
    </a>
  );
}

type NavRailItemProperties = ComponentPropsWithoutRef<"a"> &
  Readonly<{ active?: boolean; icon: LucideIcon; label: string }>;

export function NavRailItem({ active = false, className, icon: Icon, label, ...properties }: NavRailItemProperties) {
  return (
    <a
      {...properties}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={cn(
        "grid size-10 place-items-center rounded-md transition-colors",
        active ? activeClasses : idleClasses,
        className,
      )}
      title={label}
    >
      <Icon aria-hidden="true" className="size-4.5" />
    </a>
  );
}

export function NavSectionLabel({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="mb-2 text-caption font-semibold tracking-widest text-muted-foreground uppercase">{children}</p>;
}
