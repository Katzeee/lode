import type { ReactNode } from "react";

import { Badge } from "../components/badge.js";
import { Checkbox } from "../components/checkbox.js";
import { cn } from "../components/cn.js";
import {
  OutlineBullet,
  OutlineBulletDot,
  OutlineRowProgress,
  type OutlineChildrenLayout,
  type OutlineContentStyle,
  type OutlinePresentationContext,
  type OutlinePresentationRegistry,
} from "../components/outline/outline-tree.js";

export type DemoFieldGlyph = "checkbox" | "date" | "number" | "options" | "supertag" | "text";

type DemoPresentationBase = Readonly<{
  appearance: "node" | "reference";
  badges?: readonly Readonly<{ label: string; tone: "accent" }>[];
  checkbox?: Readonly<{ checked: boolean; label: string }>;
  childrenLayout?: OutlineChildrenLayout;
  contentStyle?: OutlineContentStyle;
  progress?: Readonly<{ max: number; value: number }>;
}>;

export type DemoOutlinePresentation = DemoPresentationBase &
  (
    | Readonly<{ kind: "calendar" | "plain" | "search" }>
    | Readonly<{
        datatype: DemoFieldGlyph;
        kind: "field";
        prominence: "default" | "strong";
      }>
  );

export type DemoOutlinePresentationAction =
  | Readonly<{ type: "configure-field" }>
  | Readonly<{ type: "open-node" }>
  | Readonly<{ checked: boolean; type: "set-checked" }>;

function FieldTypeGlyph({ datatype }: Readonly<{ datatype: DemoFieldGlyph }>) {
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

function FieldMark({ datatype, prominence }: Readonly<{ datatype: DemoFieldGlyph; prominence: "default" | "strong" }>) {
  return (
    <span
      className={cn(
        "grid size-3.5 place-items-center rounded-xs border border-primary/55 bg-primary/5 text-primary transition-[background-color,border-color]",
        prominence === "strong" && "border-primary/70 bg-primary/10",
      )}
      data-datatype={datatype}
      data-prominence={prominence}
      data-ui="outline-field-mark"
    >
      <FieldTypeGlyph datatype={datatype} />
    </span>
  );
}

function SearchMark() {
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

function CalendarMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-2.5 text-muted-foreground"
      data-ui="outline-calendar-mark"
      viewBox="0 0 10 10"
    >
      <path
        d="M2.25 3.25h5.5m-4.25-2v2m3-2v2M2.5 2h5v6h-5z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="0.9"
      />
    </svg>
  );
}

function bulletContent(presentation: DemoOutlinePresentation): ReactNode {
  if (presentation.kind === "field") {
    return <FieldMark datatype={presentation.datatype} prominence={presentation.prominence} />;
  }
  if (presentation.kind === "search") {
    return <SearchMark />;
  }
  if (presentation.kind === "calendar") {
    return <CalendarMark />;
  }
  return <OutlineBulletDot />;
}

function bullet(
  presentation: DemoOutlinePresentation,
  context: OutlinePresentationContext<DemoOutlinePresentationAction>,
) {
  const marker = presentation.kind === "plain" ? "default" : presentation.kind;
  return {
    accessibilityLabel: presentation.kind === "field" ? `Configure ${context.itemLabel}` : `Open ${context.itemLabel}`,
    action: presentation.kind === "field" ? ({ type: "configure-field" } as const) : ({ type: "open-node" } as const),
    content: (
      <span
        className="contents"
        data-appearance={presentation.appearance}
        data-bullet-marker={marker}
        data-ui="outline-item-bullet"
      >
        <OutlineBullet
          frame={presentation.appearance === "reference" ? "dashed" : "none"}
          halo={context.state.hasChildren && !context.state.expanded ? "muted" : "none"}
        >
          {bulletContent(presentation)}
        </OutlineBullet>
      </span>
    ),
  };
}

function suffix(presentation: DemoOutlinePresentation): ReactNode {
  if (presentation.badges === undefined) {
    return undefined;
  }
  return presentation.badges.map((badge) => (
    <Badge
      className="ml-1.5 align-[0.08em]"
      data-ui="outline-row-badge"
      key={badge.label}
      size="inline"
      tone={badge.tone}
    >
      {badge.label}
    </Badge>
  ));
}

export const demoOutlinePresentationRegistry: OutlinePresentationRegistry<
  DemoOutlinePresentation,
  DemoOutlinePresentationAction
> = {
  resolve: (presentation, context) => ({
    bullet: bullet(presentation, context),
    childrenLayout: presentation.childrenLayout,
    contentStyle: presentation.contentStyle,
    leading:
      presentation.checkbox === undefined ? undefined : (
        <Checkbox
          aria-label={presentation.checkbox.label}
          checked={presentation.checkbox.checked}
          className="size-4"
          disabled={!context.canDispatch}
          onCheckedChange={(checked) => context.dispatch({ checked, type: "set-checked" })}
          onClick={(event) => event.stopPropagation()}
          tabIndex={-1}
        />
      ),
    suffix: suffix(presentation),
    trailing:
      presentation.progress === undefined ? undefined : (
        <OutlineRowProgress max={presentation.progress.max} value={presentation.progress.value} />
      ),
  }),
};
