import { demoInlineIds, demoTokenTarget } from "./outline-demo-inline.js";
import { resolveDemoContent } from "./outline-demo-content.js";
import type { OutlineContent } from "../components/outline/outline-content.js";
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
  if (current === undefined) {
    return graph;
  }
  const updated = update(current);
  const proposed = { ...graph, nodes: { ...graph.nodes, [nodeId]: updated } };
  const content = resolveDemoContent(proposed, updated.value.content);
  const next = { ...updated, value: { ...updated.value, content } };
  return JSON.stringify(current) === JSON.stringify(next)
    ? graph
    : {
        ...proposed,
        nodes: { ...proposed.nodes, [nodeId]: next },
      };
}

export function updateGraphContent(graph: DemoGraph, path: string, content: OutlineContent): DemoGraph {
  const resolved = resolveGraphPath(graph, path);
  return resolved === null
    ? graph
    : updateGraphNode(graph, resolved.node.id, (node) => ({
        ...node,
        value: { ...node.value, content },
      }));
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
  const pendingNodes: string[] = [];
  while (pending.length > 0 || pendingNodes.length > 0) {
    const candidateId = pending.pop();
    if (candidateId !== undefined) {
      const occurrence = retargeted.occurrences[candidateId];
      if (occurrence !== undefined && !reachableOccurrenceIds.has(candidateId)) {
        reachableOccurrenceIds.add(candidateId);
        pendingNodes.push(occurrence.nodeId);
      }
      continue;
    }
    const nodeId = pendingNodes.pop();
    const node = nodeId === undefined ? undefined : retargeted.nodes[nodeId];
    if (node === undefined || reachableNodeIds.has(node.id)) {
      continue;
    }
    reachableNodeIds.add(node.id);
    pending.push(...node.childOccurrenceIds);
    if (node.value.field?.kind === "field") {
      pendingNodes.push(node.value.field.definitionId);
    }
    for (const inline of node.value.content) {
      if (
        inline.type === "token" &&
        (inline.extension === demoInlineIds.reference || inline.extension === demoInlineIds.supertag)
      ) {
        const target = demoTokenTarget(inline);
        if (target !== null) {
          pendingNodes.push(target);
        }
      }
    }
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
  const normalized = updateGraphNode(withRecords, node.id, (current) => current);
  return replaceContainer(normalized, parentKey, (ids) => [...ids.slice(0, index), occurrence.id, ...ids.slice(index)]);
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

export function siblingLocation(
  graph: DemoGraph,
  key: string,
): Readonly<{ index: number; parentKey: string | null }> | null {
  const segments = key.split("/");
  const occurrenceId = segments.pop();
  const parentKey = segments.length === 0 ? null : segments.join("/");
  const ids =
    parentKey === null ? graph.rootOccurrenceIds : resolveGraphPath(graph, parentKey)?.node.childOccurrenceIds;
  const index = occurrenceId === undefined ? -1 : (ids?.indexOf(occurrenceId) ?? -1);
  return index < 0 ? null : { index, parentKey };
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
