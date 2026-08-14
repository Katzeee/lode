import type { Projection } from "../reconcile/index.js";
import type { NodePresentation } from "./types.js";

type NodePresentationSource = Pick<
  Projection,
  "nodes" | "occurrences" | "nodeOwners" | "nodeStatuses" | "templateFields" | "materializedFields"
>;

export function resolveNodePresentation(
  projection: NodePresentationSource,
  occurrenceId: string,
): NodePresentation {
  const occurrence = projection.occurrences[occurrenceId];
  if (!occurrence) {
    throw new Error(`Occurrence does not exist: ${occurrenceId}`);
  }
  const node = projection.nodes[occurrence.nodeId];
  if (!node) {
    throw new Error(`Node does not exist: ${occurrence.nodeId}`);
  }
  const text = node.text.map((atom) => atom.value).join("");
  return {
    nodeId: node.nodeId,
    occurrenceId,
    occurrence: {
      kind:
        projection.nodeOwners[node.nodeId] === occurrence.parentNodeId ? "original" : "reference",
    },
    nodeType: projection.nodeStatuses[node.nodeId]?.nodeType ?? null,
    content: { kind: "text", text },
    fieldOccurrence: findFieldOccurrence(projection, occurrenceId),
  };
}

function findFieldOccurrence(
  projection: Pick<Projection, "templateFields" | "materializedFields">,
  occurrenceId: string,
): NodePresentation["fieldOccurrence"] {
  for (const [ownerNodeId, fields] of Object.entries(projection.templateFields)) {
    const field = fields.find((candidate) => candidate.fieldOccurrenceId === occurrenceId);
    if (field) {
      return { ownerNodeId, fieldDefinitionId: field.fieldDefinitionId };
    }
  }
  for (const [ownerNodeId, fields] of Object.entries(projection.materializedFields)) {
    const field = fields.find((candidate) => candidate.fieldOccurrenceId === occurrenceId);
    if (field) {
      return { ownerNodeId, fieldDefinitionId: field.fieldDefinitionId };
    }
  }
  return null;
}
