import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";

export function Tabs({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseTabs.Root>) {
  return <BaseTabs.Root {...properties} className={cn("flex flex-col", className)} />;
}

export function TabsList({ children, className, ...properties }: ComponentPropsWithoutRef<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List {...properties} className={cn("relative flex gap-1 border-b border-border", className)}>
      {children}
      <BaseTabs.Indicator
        className="absolute bottom-0 h-0.5 rounded-full bg-primary transition-[left,width] duration-(--lode-duration-fast) ease-(--lode-ease-standard)"
        style={{ left: "var(--active-tab-left)", width: "var(--active-tab-width)" }}
      />
    </BaseTabs.List>
  );
}

export function Tab({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      {...properties}
      className={cn(
        "rounded-t-sm px-3 py-2 text-label font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45 data-disabled:opacity-50 data-selected:text-foreground",
        className,
      )}
    />
  );
}

export function TabPanel({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseTabs.Panel>) {
  return (
    <BaseTabs.Panel
      {...properties}
      className={cn("pt-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/45", className)}
    />
  );
}
