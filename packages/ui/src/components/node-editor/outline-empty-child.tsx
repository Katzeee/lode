import { OutlineBullet, OutlineBulletDot } from "./outline-bullet.js";

export function OutlineEmptyChild({
  onActivate,
  parentLabel,
  parentKey,
}: Readonly<{
  onActivate: () => void;
  parentLabel: string;
  parentKey: string | null;
}>) {
  return (
    <button
      aria-label={parentKey === null ? "Create node" : `Create child under ${parentLabel}`}
      className="group/outline-row flex text-document-body min-h-7 w-full min-w-0 items-start rounded-selection bg-transparent pr-1.5 text-left outline-none transition-colors hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring/45"
      style={{ gap: "var(--lode-outline-gap)", paddingBlock: "var(--lode-outline-row-padding)" }}
      data-parent-key={parentKey ?? undefined}
      data-ui="outline-empty-child-placeholder"
      onClick={onActivate}
      onMouseDown={(event) => event.preventDefault()}
      tabIndex={-1}
      type="button"
    >
      <span className="flex shrink-0 items-center">
        <span
          style={{ width: "var(--lode-outline-bullet)", height: "1lh" }}
          className="grid place-items-center rounded-full transition-colors group-hover/outline-row:bg-secondary"
        >
          <OutlineBullet>
            <OutlineBulletDot quiet />
          </OutlineBullet>
        </span>
      </span>
      <span aria-hidden className="min-w-0 flex-1">
        <span className="block min-h-lh" />
      </span>
    </button>
  );
}
