import type { SequenceAnchor } from "../fact/index.js";
import type { Projection } from "./projection-types.js";

export function sequenceAnchorAt(identities: readonly string[], index: number): SequenceAnchor {
  return {
    after: identities[index - 1] ?? null,
    before: identities[index + 1] ?? null,
    affinity: index === 0 ? "before" : "after",
    fallback: index === 0 ? "start" : "end",
  };
}

export function occurrenceAnchor(
  projection: Pick<Projection, "occurrences" | "childOccurrences">,
  occurrenceId: string,
): SequenceAnchor {
  const occurrence = projection.occurrences[occurrenceId];
  const siblings = occurrence ? (projection.childOccurrences[occurrence.parentNodeId] ?? []) : [];
  const index = siblings.indexOf(occurrenceId);
  return {
    after: index > 0 ? (siblings[index - 1] ?? null) : null,
    before: index >= 0 ? (siblings[index + 1] ?? null) : null,
    affinity: "after",
    fallback: index <= 0 ? "start" : "end",
  };
}

export function insertAtAnchor(list: string[], identity: string, anchor: SequenceAnchor): void {
  insertManyAtAnchor(list, [identity], anchor, (value) => value);
}

export function insertManyAtAnchor<T>(
  list: T[],
  inserted: readonly T[],
  anchor: SequenceAnchor,
  identityOf: (value: T) => string,
): void {
  const identities = new Set(list.map(identityOf));
  const unique = inserted.filter((value) => {
    const identity = identityOf(value);
    if (identities.has(identity)) {
      return false;
    }
    identities.add(identity);
    return true;
  });
  if (unique.length === 0) {
    return;
  }
  const afterIndex = anchor.after === null ? -1 : list.findIndex((value) => identityOf(value) === anchor.after);
  const beforeIndex = anchor.before === null ? -1 : list.findIndex((value) => identityOf(value) === anchor.before);
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
  list.splice(index, 0, ...unique);
}

export function listFor(childOccurrences: Map<string, string[]>, parentNodeId: string): string[] {
  const existing = childOccurrences.get(parentNodeId);
  if (existing) {
    return existing;
  }
  const created: string[] = [];
  childOccurrences.set(parentNodeId, created);
  return created;
}

export function removePlacement(childOccurrences: ReadonlyMap<string, string[]>, occurrenceId: string): void {
  for (const siblings of childOccurrences.values()) {
    const index = siblings.indexOf(occurrenceId);
    if (index >= 0) {
      siblings.splice(index, 1);
    }
  }
}
