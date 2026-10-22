import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";
import { Icon } from "./icon.js";

export function Checkbox({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseCheckbox.Root>) {
  return (
    <BaseCheckbox.Root
      {...properties}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-xs border border-input bg-card shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
    >
      <BaseCheckbox.Indicator className="data-unchecked:hidden">
        <Icon className="size-3.5" name="check" />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
