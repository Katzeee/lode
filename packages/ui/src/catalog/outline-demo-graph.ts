import { contentToPlainText } from "../components/outline/outline-content.js";
import type { DemoGraph, DemoNode, DemoOccurrence } from "./outline-demo-model.js";

export function resolveGraphPath(
  graph: DemoGraph,
  key: string,
): Readonly<{ node: DemoNode; occurrence: DemoOccurrence }> | null {
  let ids = graph.rootOccurrenceIds;
  let resolved: Readonly<{ node: DemoNode; occurrence: DemoOccurrence }> | null = null;
  for (const occurrenceId of key.split("/")) {
    if (!ids.includes(occurrenceId)) {
      return null;
    }
    const occurrence = graph.occurrences[occurrenceId];
    const node = occurrence === undefined ? undefined : graph.nodes[occurrence.nodeId];
    if (occurrence === undefined || node === undefined) {
      return null;
    }
    resolved = { node, occurrence };
    ids = node.childOccurrenceIds;
  }
  return resolved;
}

export function updateGraphNode(graph: DemoGraph, nodeId: string, update: (node: DemoNode) => DemoNode): DemoGraph {
  const current = graph.nodes[nodeId];
  return current === undefined ? graph : { ...graph, nodes: { ...graph.nodes, [nodeId]: update(current) } };
}

export function updateGraphOccurrence(
  graph: DemoGraph,
  occurrenceId: string,
  update: (occurrence: DemoOccurrence) => DemoOccurrence,
): DemoGraph {
  const current = graph.occurrences[occurrenceId];
  return current === undefined
    ? graph
    : { ...graph, occurrences: { ...graph.occurrences, [occurrenceId]: update(current) } };
}

export function replaceGraphOccurrenceNode(graph: DemoGraph, occurrenceId: string, node: DemoNode): DemoGraph {
  const occurrence = graph.occurrences[occurrenceId];
  if (occurrence === undefined) {
    return graph;
  }
  const withNode = {
    ...graph,
    nodes: { ...graph.nodes, [node.id]: node },
  };
  return retargetGraphOccurrence(withNode, occurrenceId, node.id, undefined);
}

export function retargetGraphOccurrence(
  graph: DemoGraph,
  occurrenceId: string,
  nodeId: string,
  appearance: DemoOccurrence["appearance"],
): DemoGraph {
  if (graph.nodes[nodeId] === undefined || graph.occurrences[occurrenceId] === undefined) {
    return graph;
  }
  const retargeted = updateGraphOccurrence(graph, occurrenceId, (occurrence) => ({
    ...occurrence,
    appearance,
    nodeId,
  }));
  const reachableNodeIds = new Set<string>();
  const reachableOccurrenceIds = new Set<string>();
  const pending = [...retargeted.rootOccurrenceIds];
  while (pending.length > 0) {
    const candidateId = pending.pop();
    if (candidateId === undefined || reachableOccurrenceIds.has(candidateId)) {
      continue;
    }
    const candidate = retargeted.occurrences[candidateId];
    const candidateNode = candidate === undefined ? undefined : retargeted.nodes[candidate.nodeId];
    if (candidate === undefined || candidateNode === undefined) {
      continue;
    }
    reachableOccurrenceIds.add(candidate.id);
    reachableNodeIds.add(candidateNode.id);
    pending.push(...candidateNode.childOccurrenceIds);
  }
  return {
    nodes: Object.fromEntries(Object.entries(retargeted.nodes).filter(([id]) => reachableNodeIds.has(id))),
    occurrences: Object.fromEntries(
      Object.entries(retargeted.occurrences).filter(([id]) => reachableOccurrenceIds.has(id)),
    ),
    rootOccurrenceIds: retargeted.rootOccurrenceIds,
  };
}

function replaceContainer(
  graph: DemoGraph,
  parentKey: string | null,
  update: (ids: readonly string[]) => readonly string[],
): DemoGraph {
  if (parentKey === null) {
    return { ...graph, rootOccurrenceIds: update(graph.rootOccurrenceIds) };
  }
  const parent = resolveGraphPath(graph, parentKey);
  return parent === null
    ? graph
    : updateGraphNode(graph, parent.node.id, (node) => ({
        ...node,
        childOccurrenceIds: update(node.childOccurrenceIds),
      }));
}

export function insertGraphNode(
  graph: DemoGraph,
  parentKey: string | null,
  index: number,
  node: DemoNode,
  occurrence: DemoOccurrence,
): DemoGraph {
  const withRecords = {
    ...graph,
    nodes: { ...graph.nodes, [node.id]: node },
    occurrences: { ...graph.occurrences, [occurrence.id]: occurrence },
  };
  return replaceContainer(withRecords, parentKey, (ids) => [
    ...ids.slice(0, index),
    occurrence.id,
    ...ids.slice(index),
  ]);
}

export function removeGraphOccurrence(graph: DemoGraph, key: string): DemoGraph {
  const segments = key.split("/");
  const occurrenceId = segments.pop();
  return occurrenceId === undefined
    ? graph
    : replaceContainer(graph, segments.length === 0 ? null : segments.join("/"), (ids) =>
        ids.filter((id) => id !== occurrenceId),
      );
}

export function searchNodes(graph: DemoGraph, query: string): readonly { id: string; label: string }[] {
  const normalized = query.toLocaleLowerCase();
  return Object.values(graph.nodes)
    .map((node) => ({ id: node.id, label: contentToPlainText(node.value.content) }))
    .filter((node) => node.label.toLocaleLowerCase().includes(normalized))
    .slice(0, 20);
}

export function findOriginalOccurrenceKey(graph: DemoGraph, nodeId: string): string | null {
  const visit = (
    ids: readonly string[],
    parentKey: string | null,
    ancestorNodeIds: ReadonlySet<string>,
  ): string | null => {
    for (const occurrenceId of ids) {
      const occurrence = graph.occurrences[occurrenceId];
      if (occurrence === undefined) {
        continue;
      }
      const key = parentKey === null ? occurrenceId : `${parentKey}/${occurrenceId}`;
      if (occurrence.nodeId === nodeId && occurrence.appearance !== "reference") {
        return key;
      }
      if (ancestorNodeIds.has(occurrence.nodeId)) {
        continue;
      }
      const nested = visit(
        graph.nodes[occurrence.nodeId]?.childOccurrenceIds ?? [],
        key,
        new Set(ancestorNodeIds).add(occurrence.nodeId),
      );
      if (nested !== null) {
        return nested;
      }
    }
    return null;
  };
  return visit(graph.rootOccurrenceIds, null, new Set());
}
