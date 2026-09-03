import { Checkbox } from "../components/checkbox.js";
import { cn } from "../components/cn.js";
import { contentToPlainText } from "../components/outline-content.js";
import {
  OutlineBullet,
  OutlineInlineContent,
  OutlineRowContent,
  OutlineRowProgress,
  type OutlineRow,
} from "../components/outline-tree.js";
import type { FieldDatatype, NodeValue } from "./outline-demo-model.js";

function FieldTypeGlyph({ datatype }: Readonly<{ datatype: FieldDatatype }>) {
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
  if (datatype === "options-from-supertag") {
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

export function DemoRow({ row }: Readonly<{ row: OutlineRow<NodeValue> }>) {
  const value = row.occurrence.value;
  const label = contentToPlainText(value.content);
  const badges = [...(value.tags?.map((tag) => ({ label: tag, tone: "accent" as const })) ?? [])];
  return (
    <OutlineRowContent
      badges={badges}
      className={cn(value.todo === "done" && "text-muted-foreground line-through")}
      leading={
        value.todo === undefined ? undefined : (
          <Checkbox
            aria-label={`Toggle ${label}`}
            className="size-4"
            defaultChecked={value.todo === "done"}
            onClick={(event) => event.stopPropagation()}
            tabIndex={-1}
          />
        )
      }
      trailing={
        value.progress === undefined ? undefined : (
          <OutlineRowProgress max={value.progress.max} value={value.progress.value} />
        )
      }
    >
      <span className={cn(value.field?.kind === "field" && "font-medium text-muted-foreground")}>
        <OutlineInlineContent content={value.content} />
      </span>
    </OutlineRowContent>
  );
}

export function DemoBullet({
  fieldDatatype,
  fieldValue,
  row,
  selected,
}: Readonly<{
  fieldDatatype?: FieldDatatype;
  fieldValue: boolean;
  row: OutlineRow<NodeValue>;
  selected: boolean;
}>) {
  const value = row.occurrence.value;
  const fieldKind = value.field?.kind;
  const kind = fieldValue
    ? "field-value"
    : fieldKind === "field"
      ? "field"
      : fieldKind === "definition"
        ? "field-definition"
        : (value.bullet ?? (row.occurrence.appearance === "reference" ? "reference" : "node"));
  const datatype = fieldKind === "definition" ? "plain" : fieldDatatype;
  const marker = fieldValue ? undefined : fieldKind !== undefined ? (
    <span
      className={cn(
        "grid size-3.5 place-items-center rounded-xs border bg-primary/5 text-primary transition-[background-color,border-color]",
        fieldKind === "field" ? "border-primary/55" : "border-primary/70 bg-primary/10",
        selected && "border-primary bg-primary/15",
      )}
    >
      <FieldTypeGlyph datatype={datatype ?? "plain"} />
    </span>
  ) : value.bullet === "search" ? (
    <svg
      aria-hidden="true"
      className={cn("size-2.5 text-muted-foreground", selected && "text-primary")}
      data-ui="outline-search-mark"
      viewBox="0 0 10 10"
    >
      <circle cx="4" cy="4" fill="none" r="2.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="m5.9 5.9 2.3 2.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
    </svg>
  ) : value.bullet === "calendar" ? (
    <span className="size-1 rounded-xs bg-muted-foreground" />
  ) : value.bullet === "person" ? (
    <span className="size-1 rounded-full bg-primary" />
  ) : undefined;
  return (
    <span data-datatype={datatype} data-kind={kind}>
      <OutlineBullet
        appearance={row.occurrence.appearance === "reference" ? "reference" : "node"}
        haloed={row.hasChildren && !row.expanded}
        selected={selected}
        tone={value.tags === undefined ? "default" : "accent"}
      >
        {marker}
      </OutlineBullet>
    </span>
  );
}
