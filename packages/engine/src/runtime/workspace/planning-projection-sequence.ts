import type { Mutation, SequenceAnchor } from "../../domain/fact/index.js";

import type { MutableProjection } from "./planning-projection-mutation.js";

export function detachChild(projection: MutableProjection, occurrenceId: string): void {
  for (const [parent, ids] of Object.entries(projection.children)) {
    projection.children[parent] = ids.filter((id) => id !== occurrenceId);
  }
}

export function removeOccurrence(projection: MutableProjection, occurrenceId: string): void {
  const occurrence = projection.occurrences[occurrenceId];
  if (!occurrence) {
    return;
  }
  detachChild(projection, occurrenceId);
  delete projection.occurrences[occurrenceId];
}

export function insertChild(
  projection: MutableProjection,
  occurrenceId: string,
  parent: string,
  anchor: Extract<Mutation, { kind: "occurrence-create" }>["anchor"],
): void {
  const ids = [...(projection.children[parent] ?? [])].filter((id) => id !== occurrenceId);
  ids.splice(
    insertionIndex(
      ids.map((id) => ({ id })),
      anchor,
    ),
    0,
    occurrenceId,
  );
  projection.children[parent] = ids;
}

export function insertionIndex(
  values: readonly { id: string }[],
  anchor: { after: string | null; before: string | null; fallback: "start" | "end" },
): number {
  const after = anchor.after === null ? -1 : values.findIndex((value) => value.id === anchor.after);
  if (after >= 0) {
    return after + 1;
  }
  const before =
    anchor.before === null ? -1 : values.findIndex((value) => value.id === anchor.before);
  return before >= 0 ? before : anchor.fallback === "start" ? 0 : values.length;
}

export function assertRelationAnchor(
  identities: readonly string[],
  anchor: SequenceAnchor,
  label: string,
): void {
  if ([anchor.after, anchor.before].some((id) => id !== null && !identities.includes(id))) {
    throw new Error(`${label} anchor does not exist`);
  }
}

export function anchorAt(identities: readonly string[], index: number): SequenceAnchor {
  return {
    after: identities[index - 1] ?? null,
    before: identities[index + 1] ?? null,
    affinity: index === 0 ? "before" : "after",
    fallback: index === 0 ? "start" : "end",
  };
}
