import { cn } from "./cn.js";

export function Skeleton({ className }: Readonly<{ className?: string }>) {
  return <div aria-hidden className={cn("animate-pulse rounded-sm bg-muted", className)} />;
}
