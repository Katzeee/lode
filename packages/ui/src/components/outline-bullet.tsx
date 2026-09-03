import type { ReactNode } from "react";

import { cn } from "./cn.js";

export type OutlineBulletAppearance = "node" | "placeholder" | "reference";

export function OutlineBullet({
  appearance = "node",
  children,
  haloed,
  selected = false,
  tone = "default",
}: Readonly<{
  appearance?: OutlineBulletAppearance;
  children?: ReactNode;
  haloed: boolean;
  selected?: boolean;
  tone?: "accent" | "default";
}>) {
  return (
    <span
      className={cn(
        "relative grid size-3.5 place-items-center rounded-full transition-[background-color,box-shadow]",
        haloed && tone === "default" && "bg-secondary ring-2 ring-inset ring-secondary",
        haloed && tone === "accent" && "bg-primary/10 ring-2 ring-inset ring-primary/10",
        selected && "bg-primary/10",
      )}
      data-appearance={appearance}
      data-ui="outline-bullet-mark"
    >
      {appearance === "reference" ? (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full border border-dashed border-muted-foreground/65 transition-colors",
            selected && "border-primary",
          )}
          data-ui="outline-reference-ring"
        />
      ) : null}
      <span className="relative z-10 grid place-items-center">
        {children ??
          (appearance === "placeholder" ? (
            <span className="size-1 rounded-full bg-muted-foreground/55" data-ui="outline-placeholder-bullet" />
          ) : (
            <span
              className={cn(
                "size-1 rounded-full",
                tone === "default" && "bg-muted-foreground",
                tone === "accent" && "bg-primary",
                selected && "bg-primary",
              )}
            />
          ))}
      </span>
    </span>
  );
}
