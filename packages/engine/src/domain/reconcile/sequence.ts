import type { SequenceAnchor } from "../fact/index.js";

export function insertAtAnchor(list: string[], identity: string, anchor: SequenceAnchor): void {
  insertManyAtAnchor(list, [identity], anchor, (value) => value);
}

export function insertManyAtAnchor<T>(
  list: T[],
  inserted: readonly T[],
  anchor: SequenceAnchor,
  identityOf: (value: T) => string,
): void {
  const afterIndex =
    anchor.after === null ? -1 : list.findIndex((value) => identityOf(value) === anchor.after);
  const beforeIndex =
    anchor.before === null ? -1 : list.findIndex((value) => identityOf(value) === anchor.before);
  let index: number;
  if (afterIndex >= 0 && beforeIndex >= 0 && afterIndex < beforeIndex) {
    index = anchor.affinity === "after" ? afterIndex + 1 : beforeIndex;
  } else if (afterIndex >= 0) {
    index = afterIndex + 1;
  } else if (beforeIndex >= 0) {
    index = beforeIndex;
  } else {
    index = anchor.fallback === "start" ? 0 : list.length;
  }
  list.splice(index, 0, ...inserted);
}

export function listFor(
  children: Map<string, string[]>,
  parentOccurrenceId: string | null,
): string[] {
  const key = parentOccurrenceId ?? "$root";
  const existing = children.get(key);
  if (existing) {
    return existing;
  }
  const created: string[] = [];
  children.set(key, created);
  return created;
}

export function removePlacement(
  children: ReadonlyMap<string, string[]>,
  occurrenceId: string,
): void {
  for (const siblings of children.values()) {
    const index = siblings.indexOf(occurrenceId);
    if (index >= 0) {
      siblings.splice(index, 1);
    }
  }
}
