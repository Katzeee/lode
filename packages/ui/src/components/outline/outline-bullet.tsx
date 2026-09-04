import type { ReactNode } from "react";

import { cn } from "../cn.js";

export function OutlineBullet({
  children,
  frame = "none",
  halo = "none",
}: Readonly<{
  children?: ReactNode;
  frame?: "dashed" | "none";
  halo?: "accent" | "muted" | "none";
}>) {
  return (
    <span
      className={cn(
        "pointer-events-none relative grid size-3.75 place-items-center rounded-full transition-[background-color,box-shadow]",
        halo === "muted" && "bg-secondary ring-2 ring-inset ring-secondary",
        halo === "accent" && "bg-primary/10 ring-2 ring-inset ring-primary/10",
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
