import type { Mutation } from "../fact/index.js";

export type FieldContentDeletion = Extract<
  Mutation,
  { kind: "field-value-delete" | "materialized-field-delete" }
>;

export function isFieldContentDeletion(mutation: Mutation): mutation is FieldContentDeletion {
  return mutation.kind === "field-value-delete" || mutation.kind === "materialized-field-delete";
}

export function addFieldContentDeletionSupport(
  support: Set<string>,
  mutation: FieldContentDeletion,
  existence: Readonly<{
    occurrences: ReadonlyMap<string, readonly string[]>;
    nodes: ReadonlyMap<string, readonly string[]>;
    viable: ReadonlySet<string>;
  }>,
): void {
  const occurrenceId =
    mutation.kind === "field-value-delete"
      ? mutation.valueOccurrenceId
      : mutation.fieldOccurrenceId;
  addIfPresent(support, effectiveCandidate(existence.occurrences, occurrenceId, existence.viable));
  if (mutation.kind === "materialized-field-delete") {
    addIfPresent(
      support,
      effectiveCandidate(existence.nodes, mutation.fieldNodeId, existence.viable),
    );
  }
}

function effectiveCandidate(
  candidatesByIdentity: ReadonlyMap<string, readonly string[]>,
  identity: string,
  viable: ReadonlySet<string>,
): string | undefined {
  const candidates = candidatesByIdentity.get(identity);
  return candidates?.find((candidate) => viable.has(candidate)) ?? candidates?.[0];
}

function addIfPresent(target: Set<string>, value: string | undefined): void {
  if (value !== undefined) {
    target.add(value);
  }
}
