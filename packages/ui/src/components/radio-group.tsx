import { Radio as BaseRadio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";

export function RadioGroup({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseRadioGroup>) {
  return <BaseRadioGroup {...properties} className={cn("flex flex-col gap-3", className)} />;
}

export function Radio({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseRadio.Root>) {
  return (
    <BaseRadio.Root
      {...properties}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full border border-input bg-card shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-checked:border-primary data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
    >
      <BaseRadio.Indicator className="size-2.5 rounded-full bg-primary data-unchecked:hidden" />
    </BaseRadio.Root>
  );
}
