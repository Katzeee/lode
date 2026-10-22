import { Input as BaseInput } from "@base-ui/react/input";
import { useRef } from "react";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";

import { cn } from "./cn.js";

// Shared by every text-entry control, including the Combobox input.
export const inputClassName =
  "flex h-10 w-full rounded-sm border border-input bg-card px-3 text-body text-foreground shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground read-only:bg-muted read-only:shadow-none focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus:ring-destructive/25";

export function Input({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseInput>) {
  const input = useRef<HTMLInputElement>(null);

  const focusFromHitArea = (event: MouseEvent<HTMLSpanElement>) => {
    if (event.target === event.currentTarget && !properties.disabled) {
      input.current?.focus();
    }
  };

  return (
    <span className="lode-input-hit-area flex w-full items-center" data-ui="input-hit-area" onClick={focusFromHitArea}>
      <BaseInput {...properties} className={cn(inputClassName, className)} ref={input} />
    </span>
  );
}
