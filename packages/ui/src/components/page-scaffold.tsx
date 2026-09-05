import { tokens } from "@lode/design-tokens";
import type { ReactNode } from "react";

export function PageScaffold({
  actions,
  children,
  description,
  eyebrow,
  title,
  layout = "standard",
}: Readonly<{
  actions?: ReactNode;
  children: ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
  layout?: "standard" | "document";
}>) {
  return (
    <main
      className="mx-auto w-full py-8 @3xl/app-shell:py-12"
      style={{
        maxWidth: layout === "document" ? tokens.layout.content.document : tokens.layout.content.standard,
        paddingInline: tokens.layout["safe-area"].minimum,
      }}
    >
      <header
        className={`flex flex-wrap items-end justify-between gap-5 ${layout === "document" ? "" : "border-b border-border pb-7"}`}
      >
        <div className="min-w-0">
          {eyebrow === undefined ? null : (
            <p className="mb-2 text-caption font-semibold tracking-widest text-primary uppercase">{eyebrow}</p>
          )}
          <h1 className="text-page-title font-medium tracking-tight text-balance">{title}</h1>
          {description === undefined ? null : (
            <p className="mt-2 max-w-180 text-body-large text-muted-foreground">{description}</p>
          )}
        </div>
        {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className={layout === "document" ? "pt-4" : "pt-8"}>{children}</div>
    </main>
  );
}
