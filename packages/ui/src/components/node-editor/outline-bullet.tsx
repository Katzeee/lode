import { createContext, useContext, type ReactNode } from "react";

import { cn } from "../cn.js";

const OutlineBulletState = createContext({ hasChildren: false, expanded: false });
export const OutlineBulletStateProvider = OutlineBulletState.Provider;

export function OutlineBullet({
  children,
  frame = "none",
  halo,
}: Readonly<{
  children?: ReactNode;
  frame?: "dashed" | "none";
  halo?: "accent" | "muted" | "none";
}>) {
  const state = useContext(OutlineBulletState);
  const resolvedHalo = halo ?? (state.hasChildren && !state.expanded ? "muted" : "none");
  return (
    <span
      className={cn(
        "pointer-events-none relative grid size-3.75 place-items-center rounded-full transition-[background-color,box-shadow] group-hover/outline-bullet:bg-primary/10 group-hover/outline-bullet:ring-2 group-hover/outline-bullet:ring-inset group-hover/outline-bullet:ring-primary/10",
        resolvedHalo === "muted" && "bg-secondary ring-2 ring-inset ring-secondary",
        resolvedHalo === "accent" && "bg-primary/10 ring-2 ring-inset ring-primary/10",
      )}
      data-ui="outline-bullet-mark"
    >
      {frame === "dashed" ? (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-dashed border-muted-foreground/65"
          data-ui="outline-reference-ring"
        />
      ) : null}
      <span className="relative z-10 grid place-items-center">{children ?? <OutlineBulletDot />}</span>
    </span>
  );
}

export function OutlineBulletDot({
  quiet = false,
  tone = "muted",
}: Readonly<{ quiet?: boolean; tone?: "accent" | "muted" }>) {
  return (
    <span
      className={cn(
        "size-1.25 rounded-full",
        quiet && "bg-muted-foreground/55",
        !quiet && tone === "muted" && "bg-muted-foreground",
        !quiet && tone === "accent" && "bg-primary",
      )}
      data-ui={quiet ? "outline-placeholder-bullet" : "outline-node-dot"}
    />
  );
}
