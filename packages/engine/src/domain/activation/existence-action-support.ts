import { fieldDefinitionEndpointOccurrenceId, type AuthoredAction } from "../fact/index.js";
import { addIfPresent, effectiveCandidate } from "./support-candidate.js";

export type ExistenceSupport = Readonly<{
  nodes: ReadonlyMap<string, readonly string[]>;
  occurrences: ReadonlyMap<string, readonly string[]>;
  viable: ReadonlySet<string>;
}>;

export function addOccurrenceChangeSupport(
  support: Set<string>,
  occurrenceSupport: ReadonlyMap<string, readonly string[]>,
  nodeSupport: ReadonlyMap<string, readonly string[]>,
  viable: ReadonlySet<string>,
  authoredAction: Extract<AuthoredAction, { kind: "placement-remove" | "placement-move" }>,
): void {
  addIfPresent(support, effectiveCandidate(occurrenceSupport, authoredAction.placementId, viable));
  if (authoredAction.kind === "placement-move") {
    addIfPresent(support, effectiveCandidate(nodeSupport, authoredAction.parentNodeId, viable));
  }
}

export function addMaterializedFieldSupport(
  support: Set<string>,
  authoredAction: Extract<AuthoredAction, { kind: "field-materialize" }>,
  existence: ExistenceSupport,
): void {
  for (const nodeId of [authoredAction.ownerNodeId, authoredAction.fieldDefinitionId, authoredAction.fieldNodeId]) {
    addIfPresent(support, effectiveCandidate(existence.nodes, nodeId, existence.viable));
  }
  addIfPresent(support, effectiveCandidate(existence.occurrences, authoredAction.fieldOccurrenceId, existence.viable));
  addIfPresent(
    support,
    effectiveCandidate(
      existence.occurrences,
      fieldDefinitionEndpointOccurrenceId(authoredAction.fieldOccurrenceId),
      existence.viable,
    ),
  );
}
