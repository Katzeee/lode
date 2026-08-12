import type { Mutation } from "../../domain/fact/index.js";

import type { MutableProjection } from "./planning-projection-mutation.js";

export function detachChild(projection: MutableProjection, occurrenceId: string): void {
  for (const [parent, ids] of Object.entries(projection.children)) {
    projection.children[parent] = ids.filter((id) => id !== occurrenceId);
  }
}

export function removeOccurrence(
  projection: MutableProjection,
  occurrenceId: string,
  policy: "cascade" | "rehome",
): void {
  const occurrence = projection.occurrences[occurrenceId];
  if (!occurrence) {
    return;
  }
  const nested = [...(projection.children[occurrenceId] ?? [])];
  detachChild(projection, occurrenceId);
  if (policy === "cascade") {
    nested.forEach((child) => removeOccurrence(projection, child, "cascade"));
  } else {
    nested.forEach((child) => rehomeChild(projection, child, occurrence.parentOccurrenceId));
  }
  delete projection.children[occurrenceId];
  delete projection.occurrences[occurrenceId];
}

function rehomeChild(projection: MutableProjection, child: string, parent: string | null): void {
  const occurrence = projection.occurrences[child];
  if (!occurrence) {
    return;
  }
  projection.occurrences[child] = { ...occurrence, parentOccurrenceId: parent };
  insertChild(projection, child, parent, {
    after: null,
    before: null,
    affinity: "after",
    fallback: "end",
  });
}

export function insertChild(
  projection: MutableProjection,
  occurrenceId: string,
  parent: string | null,
  anchor: Extract<Mutation, { kind: "occurrence-create" }>["anchor"],
): void {
  const key = parent ?? "$root";
  const ids = [...(projection.children[key] ?? [])].filter((id) => id !== occurrenceId);
  ids.splice(
    insertionIndex(
      ids.map((id) => ({ id })),
      anchor,
    ),
    0,
    occurrenceId,
  );
  projection.children[key] = ids;
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
