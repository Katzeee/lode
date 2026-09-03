import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

export function TooltipProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <BaseTooltip.Provider delay={500}>{children}</BaseTooltip.Provider>;
}

export function Tooltip({ children, content }: Readonly<{ children: ReactElement; content: ReactNode }>) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner className="z-50" sideOffset={8}>
          <BaseTooltip.Popup className="lode-overlay-popup lode-tooltip-popup max-w-64 rounded-sm bg-foreground px-2 py-1 text-caption text-background shadow-sm">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
