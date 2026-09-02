import { cn } from "./cn.js";

export function Spinner({ className, label }: Readonly<{ className?: string; label?: string }>) {
  return (
    <span
      aria-label={label}
      className={cn(
        "inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
      role={label === undefined ? "presentation" : "status"}
    />
  );
}
