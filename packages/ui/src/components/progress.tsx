import { Progress as BaseProgress } from "@base-ui/react/progress";

import { cn } from "./cn.js";

export function Progress({
  className,
  label,
  max = 100,
  value,
}: Readonly<{
  className?: string;
  label?: string;
  max?: number;
  value: number;
}>) {
  return (
    <BaseProgress.Root className={cn("flex w-full flex-col gap-1.5", className)} max={max} value={value}>
      {label === undefined ? null : (
        <div className="flex items-baseline justify-between gap-2">
          <BaseProgress.Label className="text-label font-medium">{label}</BaseProgress.Label>
          <BaseProgress.Value className="text-caption text-muted-foreground" />
        </div>
      )}
      <BaseProgress.Track className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <BaseProgress.Indicator className="h-full rounded-full bg-primary transition-[width] duration-(--lode-duration-standard) ease-(--lode-ease-standard)" />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
