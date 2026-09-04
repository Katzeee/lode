import type { ReactNode } from "react";

import { cn } from "./cn.js";

export type OutlineBulletAppearance = "node" | "placeholder" | "reference";

export type OutlineFieldBulletDatatype = "checkbox" | "date" | "number" | "options" | "supertag" | "text";

export type OutlineBulletMarker =
  | Readonly<{ type: "calendar" | "person" | "search" }>
  | Readonly<{
      datatype: OutlineFieldBulletDatatype;
      prominence?: "default" | "strong";
      type: "field";
    }>;

export type OutlineBulletViewModel = Readonly<{
  appearance?: Exclude<OutlineBulletAppearance, "placeholder">;
  marker?: OutlineBulletMarker;
  tone?: "accent" | "default";
}>;

export function OutlineBullet({
  appearance = "node",
  children,
  haloed,
  tone = "default",
}: Readonly<{
  appearance?: OutlineBulletAppearance;
  children?: ReactNode;
  haloed: boolean;
  tone?: "accent" | "default";
}>) {
  return (
    <span
      className={cn(
        "pointer-events-none relative grid size-3.75 place-items-center rounded-full transition-[background-color,box-shadow]",
        haloed && tone === "default" && "bg-secondary ring-2 ring-inset ring-secondary",
        haloed && tone === "accent" && "bg-primary/10 ring-2 ring-inset ring-primary/10",
      )}
      data-appearance={appearance}
      data-ui="outline-bullet-mark"
    >
      {appearance === "reference" ? (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-dashed border-muted-foreground/65"
          data-ui="outline-reference-ring"
        />
      ) : null}
      <span className="relative z-10 grid place-items-center">
        {children ??
          (appearance === "placeholder" ? (
            <span className="size-1.25 rounded-full bg-muted-foreground/55" data-ui="outline-placeholder-bullet" />
          ) : (
            <span
              className={cn(
                "size-1.25 rounded-full",
                tone === "default" && "bg-muted-foreground",
                tone === "accent" && "bg-primary",
              )}
              data-ui="outline-node-dot"
            />
          ))}
      </span>
    </span>
  );
}

function FieldTypeGlyph({ datatype }: Readonly<{ datatype: OutlineFieldBulletDatatype }>) {
  if (datatype === "checkbox") {
    return (
      <svg aria-hidden="true" className="size-3" data-ui="outline-field-type-mark" viewBox="0 0 12 12">
        <path
          d="m2.5 6 2.1 2.1 4.9-4.7"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.35"
        />
      </svg>
    );
  }
  if (datatype === "date") {
    return (
      <svg aria-hidden="true" className="size-3" data-ui="outline-field-type-mark" viewBox="0 0 12 12">
        <path
          d="M3.25 1.75v1.5m5.5-1.5v1.5M2 4.25h8M2.25 2.75h7.5v7h-7.5z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1"
        />
      </svg>
    );
  }
  if (datatype === "number") {
    return (
      <svg aria-hidden="true" className="size-3" data-ui="outline-field-type-mark" viewBox="0 0 12 12">
        <text
          fill="currentColor"
          fontFamily="ui-sans-serif, sans-serif"
          fontSize="6.4"
          fontWeight="700"
          x="1.25"
          y="8.3"
        >
          12
        </text>
      </svg>
    );
  }
  if (datatype === "options") {
    return (
      <svg aria-hidden="true" className="size-3" data-ui="outline-field-type-mark" viewBox="0 0 12 12">
        <circle cx="3" cy="3.25" fill="currentColor" r="0.75" />
        <circle cx="3" cy="6" fill="currentColor" r="0.75" />
        <circle cx="3" cy="8.75" fill="currentColor" r="0.75" />
        <path d="M5 3.25h4M5 6h4M5 8.75h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
      </svg>
    );
  }
  if (datatype === "supertag") {
    return (
      <svg aria-hidden="true" className="size-3" data-ui="outline-field-type-mark" viewBox="0 0 12 12">
        <path
          d="M4.25 2.25 3.5 9.75m4.75-7.5-.75 7.5M2.25 4.5h7.5m-8 3h7.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="size-3" data-ui="outline-field-type-mark" viewBox="0 0 12 12">
      <path
        d="M3.75 2.25h4.5M6 2.25v7.5m-2.25 0h4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.15"
      />
    </svg>
  );
}

function BulletMarker({ marker }: Readonly<{ marker: OutlineBulletMarker }>) {
  if (marker.type === "field") {
    return (
      <span
        className={cn(
          "grid size-3.5 place-items-center rounded-xs border border-primary/55 bg-primary/5 text-primary transition-[background-color,border-color]",
          marker.prominence === "strong" && "border-primary/70 bg-primary/10",
        )}
        data-datatype={marker.datatype}
        data-prominence={marker.prominence ?? "default"}
        data-ui="outline-field-mark"
      >
        <FieldTypeGlyph datatype={marker.datatype} />
      </span>
    );
  }
  if (marker.type === "search") {
    return (
      <svg
        aria-hidden="true"
        className="size-2.5 text-muted-foreground"
        data-ui="outline-search-mark"
        viewBox="0 0 10 10"
      >
        <circle cx="4" cy="4" fill="none" r="2.5" stroke="currentColor" strokeWidth="1.1" />
        <path d="m5.9 5.9 2.3 2.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
      </svg>
    );
  }
  return marker.type === "calendar" ? (
    <span className="size-1 rounded-xs bg-muted-foreground" />
  ) : (
    <span className="size-1 rounded-full bg-primary" />
  );
}

export function OutlineItemBullet({
  haloed,
  viewModel = {},
}: Readonly<{ haloed: boolean; viewModel?: OutlineBulletViewModel }>) {
  return (
    <span className="contents" data-bullet-marker={viewModel.marker?.type ?? "default"} data-ui="outline-item-bullet">
      <OutlineBullet appearance={viewModel.appearance} haloed={haloed} tone={viewModel.tone}>
        {viewModel.marker === undefined ? undefined : <BulletMarker marker={viewModel.marker} />}
      </OutlineBullet>
    </span>
  );
}
