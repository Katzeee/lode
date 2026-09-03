import { Field as BaseField } from "@base-ui/react/field";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "./cn.js";

export function Field({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseField.Root>) {
  return <BaseField.Root {...properties} className={cn("flex flex-col gap-1.5", className)} />;
}

export function FieldLabel({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseField.Label>) {
  return <BaseField.Label {...properties} className={cn("text-label font-medium text-foreground", className)} />;
}

export function FieldDescription({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseField.Description>) {
  return <BaseField.Description {...properties} className={cn("text-caption text-muted-foreground", className)} />;
}

export function FieldError({ className, ...properties }: ComponentPropsWithoutRef<typeof BaseField.Error>) {
  return <BaseField.Error {...properties} className={cn("text-caption font-medium text-destructive", className)} />;
}
