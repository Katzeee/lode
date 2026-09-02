import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";

export function Textarea({ className, ...properties }: ComponentPropsWithoutRef<"textarea">) {
  return (
    <textarea
      {...properties}
      className={cn(
        "w-full rounded-sm border border-input bg-card px-3 py-2 text-body text-foreground shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}
