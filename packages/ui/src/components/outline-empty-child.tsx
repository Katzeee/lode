import { OutlineBullet } from "./outline-bullet.js";
import { cn } from "./cn.js";

export function OutlineEmptyChild({
  column,
  indentDepth,
  onActivate,
  parentKey,
  parentNodeId,
  showGuides,
}: Readonly<{
  column?: "leading" | "trailing";
  indentDepth: number;
  onActivate: () => void;
  parentKey: string;
  parentNodeId: string;
  showGuides: boolean;
}>) {
  return (
    <button
      aria-label={`Create child under ${parentNodeId}`}
      className="group/outline-row flex min-h-8 min-w-0 items-start gap-1 rounded-md bg-transparent py-1 pr-1.5 text-left outline-none transition-colors hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring/45"
      data-layout-column={column ?? "single"}
      data-level={indentDepth + 1}
      data-parent-key={parentKey}
      data-ui="outline-empty-child-placeholder"
      onClick={onActivate}
      onMouseDown={(event) => event.preventDefault()}
      tabIndex={-1}
      type="button"
    >
      {Array.from({ length: indentDepth }, (_, level) => (
        <span
          aria-hidden
          className={cn("w-5 shrink-0 self-stretch", showGuides && "ml-2.5 w-2.5 border-l border-border/45")}
          key={level}
        />
      ))}
      <span className="flex shrink-0 items-center gap-0.5 py-0.5">
        <span aria-hidden className="size-5" />
        <span className="grid size-5 place-items-center rounded-full transition-colors group-hover/outline-row:bg-secondary">
          <OutlineBullet appearance="placeholder" haloed={false} />
        </span>
      </span>
      <span aria-hidden className="min-w-0 flex-1 py-0.5">
        <span className="block min-h-5.5" />
      </span>
    </button>
  );
}
