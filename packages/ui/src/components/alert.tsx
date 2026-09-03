import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";

const alertVariants = cva("w-full rounded-md border px-4 py-3 text-body", {
  variants: {
    tone: {
      neutral: "border-border bg-card text-foreground",
      success: "border-success/25 bg-success-subtle text-success-strong",
      warning: "border-warning/30 bg-warning-subtle text-warning-strong",
      destructive: "border-destructive/25 bg-destructive-subtle text-destructive-strong",
    },
  },
  defaultVariants: { tone: "neutral" },
});

type AlertProperties = ComponentPropsWithoutRef<"div"> & VariantProps<typeof alertVariants>;

export function Alert({ className, tone, ...properties }: AlertProperties) {
  return (
    <div
      {...properties}
      className={cn(alertVariants({ tone }), className)}
      role={tone === "destructive" ? "alert" : (properties.role ?? "status")}
    />
  );
}

export function AlertTitle({ className, ...properties }: ComponentPropsWithoutRef<"p">) {
  return <p {...properties} className={cn("mb-1 font-semibold", className)} />;
}
