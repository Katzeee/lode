import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";

export function Input({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseInput>) {
  return (
    <BaseInput
      {...properties}
      className={cn(
        "flex h-10 w-full rounded-sm border border-input bg-card px-3 text-body text-foreground shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground read-only:bg-muted read-only:shadow-none focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus:ring-destructive/25",
        className,
      )}
    />
  );
}
