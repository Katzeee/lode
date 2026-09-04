export type SuggestionAction =
  "accept" | "dismiss" | "next" | "previous" | "nextPage" | "previousPage" | "first" | "last";

export type SuggestionKeyBinding = Readonly<{
  action: SuggestionAction | null;
  key: string;
  alt?: boolean;
  control?: boolean;
  meta?: boolean;
  shift?: boolean;
}>;

export type SuggestionKeyboardEvent = Readonly<{
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}>;

export const defaultSuggestionKeyBindings: readonly SuggestionKeyBinding[] = [
  { key: "ArrowDown", action: "next" },
  { key: "ArrowUp", action: "previous" },
  { key: "PageDown", action: "nextPage" },
  { key: "PageUp", action: "previousPage" },
  { key: "Tab", action: "accept" },
  { key: "Enter", action: "accept" },
  { key: "Escape", action: "dismiss" },
];

/** Registered chords take precedence, including null bindings that return a key to the editor. */
export function suggestionAction(
  event: SuggestionKeyboardEvent,
  bindings: readonly SuggestionKeyBinding[] = [],
): SuggestionAction | null {
  if (event.isComposing) {
    return null;
  }
  return (
    [...bindings, ...defaultSuggestionKeyBindings].find(
      (binding) =>
        binding.key.toLowerCase() === event.key.toLowerCase() &&
        (binding.alt ?? false) === event.altKey &&
        (binding.control ?? false) === event.ctrlKey &&
        (binding.meta ?? false) === event.metaKey &&
        (binding.shift ?? false) === event.shiftKey,
    )?.action ?? null
  );
}

export function activeSuggestionId(
  items: readonly Readonly<{ id: string }>[],
  preferredId: string | null,
): string | null {
  return preferredId !== null && items.some((item) => item.id === preferredId) ? preferredId : (items[0]?.id ?? null);
}

export type SuggestionRowGeometry = Readonly<{ id: string; top: number; height: number }>;

/** Page movement follows the measured viewport and row heights, including multiline suggestions. */
export function pageSuggestionId(
  rows: readonly SuggestionRowGeometry[],
  currentId: string,
  viewportHeight: number,
  direction: -1 | 1,
): string {
  const index = rows.findIndex((row) => row.id === currentId);
  const current = rows[index];
  if (current === undefined || rows.length === 0) {
    return currentId;
  }
  const destination = current.top + Math.max(current.height, viewportHeight) * direction;
  const candidates = rows.filter((_row, candidateIndex) =>
    direction === 1 ? candidateIndex > index : candidateIndex < index,
  );
  return (
    candidates.reduce<SuggestionRowGeometry | undefined>(
      (nearest, row) =>
        nearest === undefined || Math.abs(row.top - destination) < Math.abs(nearest.top - destination) ? row : nearest,
      undefined,
    )?.id ?? currentId
  );
}

export function revealSuggestionScrollTop(
  scrollTop: number,
  viewportHeight: number,
  row: SuggestionRowGeometry,
): number {
  if (row.top < scrollTop || row.height > viewportHeight) {
    return Math.max(0, row.top);
  }
  return row.top + row.height > scrollTop + viewportHeight
    ? Math.max(0, row.top + row.height - viewportHeight)
    : scrollTop;
}
