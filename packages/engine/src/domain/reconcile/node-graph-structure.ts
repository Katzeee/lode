import type { MutableOccurrence } from "./projection-state.js";
import { projectWorkspaceSystemNodes, type WorkspaceSystemNodes } from "./workspace-system-nodes.js";

export type NodeGraphStructure = Readonly<{
  occurrences: Map<string, MutableOccurrence>;
  childOccurrences: Map<string, string[]>;
  nodeOwners: Readonly<Record<string, string | null>>;
  workspaceSystemNodes: WorkspaceSystemNodes;
  metanodes: Readonly<Record<string, string>>;
}>;

export function projectNodeGraphStructure(
  workspaceNodeId: string,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>>,
  metanodes: Readonly<Record<string, string>>,
): NodeGraphStructure {
  const effectiveOccurrences = new Map(
    [...occurrences].map(([occurrenceId, occurrence]) => [occurrenceId, { ...occurrence }]),
  );
  const effectiveChildren = new Map([...childOccurrences].map(([nodeId, ids]) => [nodeId, [...ids]]));
  const effectiveOwners = { ...nodeOwners };
  const workspaceSystemNodes = projectWorkspaceSystemNodes(workspaceNodeId, occurrences, nodeOwners);
  return {
    occurrences: effectiveOccurrences,
    childOccurrences: effectiveChildren,
    nodeOwners: effectiveOwners,
    workspaceSystemNodes,
    metanodes,
  };
}
