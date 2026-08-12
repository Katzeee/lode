import type { Projection } from "./projection-types.js";

export type SemanticTreeNode = Readonly<{
  occurrenceId: string;
  nodeId: string;
  text: string;
  reference: boolean;
  children: readonly SemanticTreeNode[];
}>;

/** Traverses storage occurrences while terminating semantic self-reference by stable Node identity. */
export function renderSemanticTree(
  projection: Projection,
  rootOccurrenceId: string,
): SemanticTreeNode | null {
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
  const children = reference
    ? []
    : (projection.children[occurrenceId] ?? [])
        .map((childId) => renderOccurrence(projection, childId, next))
        .filter((child): child is SemanticTreeNode => child !== null);
  return {
    occurrenceId,
    nodeId: node.nodeId,
    text: node.text.map((atom) => atom.value).join(""),
    reference,
    children,
  };
}
