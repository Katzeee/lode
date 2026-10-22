import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";

export function Switch({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      {...properties}
      className={cn(
        "inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
    >
      <BaseSwitch.Thumb className="size-5 rounded-full bg-card shadow-xs transition-transform data-checked:translate-x-4" />
    </BaseSwitch.Root>
  );
}
