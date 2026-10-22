import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";

export function Card({ className, ...properties }: ComponentPropsWithoutRef<"article">) {
  return (
    <article
      {...properties}
      className={cn("rounded-lg border border-border bg-card text-card-foreground shadow-sm", className)}
    />
  );
}

export function CardHeader({ className, ...properties }: ComponentPropsWithoutRef<"header">) {
  return <header {...properties} className={cn("flex flex-col gap-1.5 p-6 pb-0", className)} />;
}

export function CardTitle({ className, ...properties }: ComponentPropsWithoutRef<"h2">) {
  return <h2 {...properties} className={cn("text-title-small font-semibold tracking-tight", className)} />;
}

export function CardDescription({ className, ...properties }: ComponentPropsWithoutRef<"p">) {
  return <p {...properties} className={cn("text-body text-muted-foreground", className)} />;
}

export function CardContent({ className, ...properties }: ComponentPropsWithoutRef<"div">) {
  return <div {...properties} className={cn("p-6", className)} />;
}

export function CardFooter({ className, ...properties }: ComponentPropsWithoutRef<"footer">) {
  return <footer {...properties} className={cn("flex items-center gap-3 p-6 pt-0", className)} />;
}
