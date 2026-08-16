import type { InlineReferenceId, JsonValue, NodeType, SequenceAnchor, TextAtomId } from "../fact/index.js";
import type { WorkspaceSystemNodes } from "./workspace-system-nodes.js";
import type { Metanodes } from "./metanodes.js";

export type TextAtom = Readonly<{
  kind: "text";
  id: TextAtomId;
  value: string;
  attributes: Readonly<Record<string, JsonValue>>;
  contributionId: string;
}>;

export type InlineReferenceTargetStatus = "active" | "trash" | "unavailable";

export type ProjectedInlineReference = Readonly<{
  kind: "inline-reference";
  id: InlineReferenceId;
  targetNodeId: string;
  aliasNodeId: string | null;
  targetStatus: InlineReferenceTargetStatus;
  contributionId: string;
}>;

export type NodeContentItem = TextAtom | ProjectedInlineReference;

export function isTextAtom(item: NodeContentItem): item is TextAtom {
  return item.kind === "text";
}

export function textAtoms(node: Pick<ProjectedNode, "content"> | undefined): readonly TextAtom[] {
  return node?.content.filter(isTextAtom) ?? [];
}

export type InlineReferenceLocation = Readonly<{
  hostNodeId: string;
  reference: ProjectedInlineReference;
  anchor: SequenceAnchor;
}>;

export function locateInlineReference(
  nodes: Readonly<Record<string, ProjectedNode>>,
  inlineReferenceId: InlineReferenceId,
): InlineReferenceLocation | null {
  for (const [hostNodeId, node] of Object.entries(nodes)) {
    const index = node.content.findIndex((item) => item.kind === "inline-reference" && item.id === inlineReferenceId);
    const item = node.content[index];
    if (index < 0 || item?.kind !== "inline-reference") {
      continue;
    }
    return {
      hostNodeId,
      reference: item,
      anchor: {
        after: index > 0 ? (node.content[index - 1]?.id ?? null) : null,
        before: index + 1 < node.content.length ? (node.content[index + 1]?.id ?? null) : null,
        affinity: "after",
        fallback: index === 0 ? "start" : "end",
      },
    };
  }
  return null;
}

export type ProjectedNode = Readonly<{
  nodeId: string;
  nodeType: NodeType | null;
  content: readonly NodeContentItem[];
}>;

export type ProjectedOccurrence = Readonly<{
  occurrenceId: string;
  nodeId: string;
  parentNodeId: string;
  derived: boolean;
}>;

export type NodeGraph = Readonly<{
  nodes: Readonly<Record<string, ProjectedNode>>;
  occurrences: Readonly<Record<string, ProjectedOccurrence>>;
  childOccurrences: Readonly<Record<string, readonly string[]>>;
  nodeOwners: Readonly<Record<string, string | null>>;
  metanodes: Metanodes;
}>;

export type NodeLocation = "active" | "trash" | "absent";

type NodeLocationGraph = Readonly<{
  nodes: Readonly<Record<string, unknown>>;
  nodeOwners: Readonly<Record<string, string | null>>;
  workspaceSystemNodes: WorkspaceSystemNodes;
}>;

export function nodeLocation(workspaceNodeId: string, graph: NodeLocationGraph, nodeId: string): NodeLocation {
  if (!graph.nodes[nodeId]) {
    return "absent";
  }
  const trashNodeId = graph.workspaceSystemNodes.trash;
  if (nodeId === workspaceNodeId || nodeId === trashNodeId) {
    return "active";
  }
  const visited = new Set<string>();
  let cursor: string | null | undefined = nodeId;
  while (cursor !== workspaceNodeId) {
    if (trashNodeId !== undefined && cursor === trashNodeId) {
      return "trash";
    }
    if (cursor === null || cursor === undefined || visited.has(cursor)) {
      return "absent";
    }
    visited.add(cursor);
    cursor = graph.nodeOwners[cursor];
  }
  return "active";
}

export function isActiveNode(workspaceNodeId: string, graph: NodeLocationGraph, nodeId: string): boolean {
  return nodeLocation(workspaceNodeId, graph, nodeId) === "active";
}

export function isNodeInTrash(workspaceNodeId: string, graph: NodeLocationGraph, nodeId: string): boolean {
  return nodeLocation(workspaceNodeId, graph, nodeId) === "trash";
}

export function isPresentNodeOutsideTrash(workspaceNodeId: string, graph: NodeLocationGraph, nodeId: string): boolean {
  return graph.nodes[nodeId] !== undefined && nodeLocation(workspaceNodeId, graph, nodeId) !== "trash";
}

type NodeGraphState = Readonly<{
  nodes: ReadonlyMap<string, Readonly<{ nodeId: string }>>;
  occurrences: ReadonlyMap<string, Readonly<{ occurrenceId: string; nodeId: string; parentNodeId: string }>>;
  childOccurrences: ReadonlyMap<string, readonly string[]>;
  nodeOwners: Readonly<Record<string, string | null>>;
  metanodes: Metanodes;
}>;

export function validateNodeGraph(graph: NodeGraphState): void {
  validateIdentities(graph);
  validateOccurrenceIndex(graph);
  validateKnownOwners(graph);
}

export function validateRootedNodeGraph(workspaceNodeId: string, graph: NodeGraphState): void {
  validateNodeGraph(graph);
  if (!graph.nodes.has(workspaceNodeId)) {
    throw new Error("Node Graph has no Workspace Node");
  }
  validateRootedOwnership(workspaceNodeId, graph);
}

function validateIdentities(graph: NodeGraphState): void {
  for (const [nodeId, node] of graph.nodes) {
    if (node.nodeId !== nodeId) {
      throw new Error(`Node Graph Node identity does not match its key: ${nodeId}`);
    }
  }
  const placements = new Set<string>();
  for (const [occurrenceId, occurrence] of graph.occurrences) {
    if (occurrence.occurrenceId !== occurrenceId) {
      throw new Error(`Node Graph Occurrence identity does not match its key: ${occurrenceId}`);
    }
    if (!graph.nodes.has(occurrence.nodeId)) {
      throw new Error(`Node Graph Occurrence target is absent: ${occurrenceId}`);
    }
    if (!graph.nodes.has(occurrence.parentNodeId)) {
      throw new Error(`Node Graph Occurrence parent is absent: ${occurrenceId}`);
    }
    const placement = JSON.stringify([occurrence.nodeId, occurrence.parentNodeId]);
    if (placements.has(placement)) {
      throw new Error(`Node Graph repeats a Node in one parent: ${occurrence.nodeId}`);
    }
    placements.add(placement);
  }
}

function validateOccurrenceIndex(graph: NodeGraphState): void {
  const indexed = new Set<string>();
  for (const [parentNodeId, occurrenceIds] of graph.childOccurrences) {
    if (!graph.nodes.has(parentNodeId)) {
      throw new Error(`Node Graph childOccurrences parent is absent: ${parentNodeId}`);
    }
    const siblings = new Set<string>();
    for (const occurrenceId of occurrenceIds) {
      if (siblings.has(occurrenceId) || indexed.has(occurrenceId)) {
        throw new Error(`Node Graph Occurrence is indexed more than once: ${occurrenceId}`);
      }
      const occurrence = graph.occurrences.get(occurrenceId);
      if (!occurrence) {
        throw new Error(`Node Graph childOccurrences entry is absent: ${occurrenceId}`);
      }
      if (occurrence.parentNodeId !== parentNodeId) {
        throw new Error(`Node Graph childOccurrences entry has another parent: ${occurrenceId}`);
      }
      siblings.add(occurrenceId);
      indexed.add(occurrenceId);
    }
  }
  for (const occurrenceId of graph.occurrences.keys()) {
    if (!indexed.has(occurrenceId)) {
      throw new Error(`Node Graph Occurrence is absent from childOccurrences: ${occurrenceId}`);
    }
  }
}

function validateKnownOwners(graph: NodeGraphState): void {
  const attachedHostsByRoot = new Map(
    Object.entries(graph.metanodes).map(([hostNodeId, rootNodeId]) => [rootNodeId, hostNodeId]),
  );
  for (const [nodeId, ownerNodeId] of Object.entries(graph.nodeOwners)) {
    if (!graph.nodes.has(nodeId)) {
      throw new Error(`Node Graph Owner subject is absent: ${nodeId}`);
    }
    if (ownerNodeId !== null && !graph.nodes.has(ownerNodeId)) {
      throw new Error(`Node Graph Owner is absent: ${nodeId}`);
    }
    if (ownerNodeId !== null) {
      const originals = [...graph.occurrences.values()].filter(
        (occurrence) => occurrence.nodeId === nodeId && occurrence.parentNodeId === ownerNodeId,
      );
      const attachedHost = attachedHostsByRoot.get(nodeId);
      const validAttachment = attachedHost === ownerNodeId && originals.length === 0;
      const validOriginal = attachedHost === undefined && originals.length === 1;
      if (!validAttachment && !validOriginal) {
        throw new Error(`Node Graph Node must have exactly one Original Occurrence: ${nodeId}`);
      }
    }
  }
  for (const [hostNodeId, rootNodeId] of Object.entries(graph.metanodes)) {
    if (!graph.nodes.has(hostNodeId) || !graph.nodes.has(rootNodeId) || graph.nodeOwners[rootNodeId] !== hostNodeId) {
      throw new Error(`Node Graph Metanode attachment is invalid: ${hostNodeId}`);
    }
  }
}

function validateRootedOwnership(workspaceNodeId: string, graph: NodeGraphState): void {
  for (const nodeId of graph.nodes.keys()) {
    if (!Object.hasOwn(graph.nodeOwners, nodeId)) {
      throw new Error(`Node Graph Node has no Owner: ${nodeId}`);
    }
    const ownerNodeId = graph.nodeOwners[nodeId];
    if (nodeId === workspaceNodeId) {
      if (ownerNodeId !== null) {
        throw new Error("Node Graph Workspace Owner must be null");
      }
      continue;
    }
    if (ownerNodeId === null || ownerNodeId === undefined || !graph.nodes.has(ownerNodeId)) {
      throw new Error(`Node Graph Owner is absent: ${nodeId}`);
    }
    validateOwnerPath(workspaceNodeId, nodeId, graph.nodeOwners);
  }
}

function validateOwnerPath(
  workspaceNodeId: string,
  nodeId: string,
  nodeOwners: Readonly<Record<string, string | null>>,
): void {
  const visited = new Set<string>();
  let cursor: string | null | undefined = nodeId;
  while (cursor !== workspaceNodeId) {
    if (cursor === null || cursor === undefined || visited.has(cursor)) {
      throw new Error(`Node Graph Owner chain does not reach the Workspace: ${nodeId}`);
    }
    visited.add(cursor);
    cursor = nodeOwners[cursor];
  }
}
