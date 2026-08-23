import type { FieldContentRemovalAction } from "../fact/index.js";
import { addIfPresent, effectiveCandidate } from "./support-candidate.js";

export function addFieldContentDeletionSupport(
  support: Set<string>,
  action: FieldContentRemovalAction,
  existence: Readonly<{
    occurrences: ReadonlyMap<string, readonly string[]>;
    nodes: ReadonlyMap<string, readonly string[]>;
    viable: ReadonlySet<string>;
  }>,
): void {
  if (action.kind === "field-value-remove") {
    addIfPresent(support, effectiveCandidate(existence.occurrences, action.valuePlacementId, existence.viable));
  }
}
