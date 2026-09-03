import type { ReactNode } from "react";

import { Badge } from "./badge.js";
import { cn } from "./cn.js";

export type OutlineRowBadge = Readonly<{
  label: string;
  tone?: "accent" | "destructive" | "neutral" | "success" | "warning";
}>;

export function OutlineRowContent({
  badges = [],
  children,
  className,
  details,
  leading,
  prefix,
  trailing,
}: Readonly<{
  badges?: readonly OutlineRowBadge[];
  children: ReactNode;
  className?: string;
  details?: ReactNode;
  leading?: ReactNode;
  prefix?: ReactNode;
  trailing?: ReactNode;
}>) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-start gap-1.5", className)} data-ui="outline-row-content">
      {leading === undefined ? null : <span className="mt-0.5 shrink-0">{leading}</span>}
      <div className="min-w-0 flex-1">
        <div className="min-w-0 whitespace-pre-wrap break-words">
          {prefix === undefined ? null : (
            <span className="mr-1.5 font-medium text-primary" data-ui="outline-row-prefix">
              {prefix}
            </span>
          )}
          {children}
          {badges.map((badge) => (
            <Badge
              className="ml-1.5 align-[0.08em]"
              data-ui="outline-row-badge"
              key={badge.label}
              size="inline"
              tone={badge.tone}
            >
              {badge.label}
            </Badge>
          ))}
          {trailing === undefined ? null : (
            <span className="ml-1.5 inline-flex align-middle" data-ui="outline-row-trailing">
              {trailing}
            </span>
          )}
        </div>
        {details === undefined ? null : (
          <div className="mt-0.5 text-caption text-muted-foreground" data-ui="outline-row-details">
            {details}
          </div>
        )}
      </div>
    </div>
  );
}

export function OutlineRowProgress({ label, max, value }: Readonly<{ label?: string; max: number; value: number }>) {
  const boundedMax = Math.max(1, max);
  const boundedValue = Math.max(0, Math.min(value, boundedMax));
  const percentage = (boundedValue / boundedMax) * 100;
  return (
    <span
      aria-label={label ?? `${String(boundedValue)} of ${String(boundedMax)}`}
      aria-valuemax={boundedMax}
      aria-valuemin={0}
      aria-valuenow={boundedValue}
      className="inline-flex items-center gap-1.5"
      role="progressbar"
    >
      <span className="h-1 w-20 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${String(percentage)}%` }} />
      </span>
      <span>{label ?? `${String(boundedValue)} / ${String(boundedMax)}`}</span>
    </span>
  );
}
