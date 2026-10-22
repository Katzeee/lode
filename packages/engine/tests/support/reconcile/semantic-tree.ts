import type { Projection } from "../../../src/domain/reconcile/projection-types.js";

export type SemanticTreeNode = Readonly<{
  occurrenceId: string;
  nodeId: string;
  text: string;
  reference: boolean;
  childOccurrences: readonly SemanticTreeNode[];
}>;

/** Traverses storage occurrences while terminating semantic self-reference by stable Node identity. */
export function renderSemanticTree(projection: Projection, rootOccurrenceId: string): SemanticTreeNode | null {
  return renderOccurrence(projection, rootOccurrenceId, new Set());
}

function renderOccurrence(
  projection: Projection,
  occurrenceId: string,
  ancestors: ReadonlySet<string>,
): SemanticTreeNode | null {
  const occurrence = projection.occurrences[occurrenceId];
  const node = occurrence ? projection.nodes[occurrence.nodeId] : undefined;
  if (!occurrence || !node) {
    return null;
  }
  const reference = ancestors.has(node.nodeId);
  const next = new Set(ancestors);
  next.add(node.nodeId);
  const childOccurrences = reference
    ? []
    : (projection.childOccurrences[node.nodeId] ?? [])
        .map((childId) => renderOccurrence(projection, childId, next))
        .filter((child): child is SemanticTreeNode => child !== null);
  return {
    occurrenceId,
    nodeId: node.nodeId,
    text: node.content
      .filter((item) => item.kind === "text")
      .map((atom) => atom.value)
      .join(""),
    reference,
    childOccurrences,
  };
}
