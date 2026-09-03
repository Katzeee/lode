import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";
import { Spinner } from "./spinner.js";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70 active:bg-secondary/60",
        outline: "border border-input bg-card text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground",
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 active:bg-destructive/80",
      },
      size: {
        sm: "h-8 gap-1.5 px-3 text-label",
        md: "h-10 px-4 text-body",
        lg: "h-12 px-6 text-body-large",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProperties = ComponentPropsWithoutRef<typeof BaseButton> &
  VariantProps<typeof buttonVariants> &
  Readonly<{ loading?: boolean }>;

export function Button({ className, loading = false, size, variant, children, ...properties }: ButtonProperties) {
  return (
    <BaseButton
      {...properties}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ size, variant }), className)}
      disabled={loading || properties.disabled}
    >
      {loading ? <Spinner className="size-4" /> : null}
      {children}
    </BaseButton>
  );
}
