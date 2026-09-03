import { Separator as BaseSeparator } from "@base-ui/react/separator";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";

export function Separator({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseSeparator>) {
  return (
    <BaseSeparator
      {...properties}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className,
      )}
    />
  );
}
