import { fieldContentDeletionOccurrenceId, type FieldContentDeletionMutation } from "../fact/index.js";
import { addIfPresent, effectiveCandidate } from "./support-candidate.js";

export function addFieldContentDeletionSupport(
  support: Set<string>,
  mutation: FieldContentDeletionMutation,
  existence: Readonly<{
    occurrences: ReadonlyMap<string, readonly string[]>;
    nodes: ReadonlyMap<string, readonly string[]>;
    viable: ReadonlySet<string>;
  }>,
): void {
  const occurrenceId = fieldContentDeletionOccurrenceId(mutation);
  addIfPresent(support, effectiveCandidate(existence.occurrences, occurrenceId, existence.viable));
  if (mutation.kind === "materialized-field-delete") {
    addIfPresent(support, effectiveCandidate(existence.nodes, mutation.fieldNodeId, existence.viable));
  }
}
