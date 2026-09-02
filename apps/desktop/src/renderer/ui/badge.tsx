import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-card text-muted-foreground",
        accent: "border-primary/20 bg-accent text-accent-foreground",
        success: "border-success/25 bg-success-subtle text-success-strong",
        warning: "border-warning/30 bg-warning-subtle text-warning-strong",
        destructive: "border-destructive/25 bg-destructive-subtle text-destructive-strong",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

type BadgeProperties = ComponentPropsWithoutRef<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...properties }: BadgeProperties) {
  return <span {...properties} className={cn(badgeVariants({ tone }), className)} />;
}

export function BadgeDot({ className }: Readonly<{ className?: string }>) {
  return <span aria-hidden="true" className={cn("size-1.5 rounded-full bg-current", className)} />;
}
