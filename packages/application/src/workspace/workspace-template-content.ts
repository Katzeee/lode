import type { NodeContentInput, NodeEditIntent, ProjectedNode } from "@lode/sdk";
import type { OutlineContent } from "@lode/ui";
import { nodeSource, resolveSource, sourceEntries, referenceData } from "./node-source.js";
import type { WorkspaceSnapshot } from "./workspace-model.js";

/** An active source editor can still submit its pre-copy opaque Reference marks. */
export function rebaseTemplateSource(
  content: OutlineContent,
  node: ProjectedNode,
  graph: WorkspaceSnapshot,
): OutlineContent {
  const instance = graph.templateNodeInstances.find(
    (item) => item.state === "detached" && item.copies.some((copy) => copy.instanceNodeId === node.nodeId),
  );
  if (!instance) {
    return content;
  }
  return content.map((part) => {
    if (part.type !== "token") {
      return part;
    }
    const data = referenceData(part);
    const mapping =
      data?.referenceId && instance.referenceCopies.find((copy) => copy.sourceReferenceId === data.referenceId);
    const reference =
      mapping &&
      node.content.find((item) => item.kind === "inline-reference" && item.id === mapping.instanceReferenceId);
    return reference && reference.kind === "inline-reference"
      ? {
          ...part,
          data: {
            ...data,
            referenceId: reference.id,
            targetNodeId: reference.targetNodeId,
            aliasNodeId: reference.aliasNodeId,
          },
        }
      : part;
  });
}

function templateNodeInput(
  node: ProjectedNode,
  content: OutlineContent,
  graph: WorkspaceSnapshot,
  baseline: OutlineContent,
) {
  const { entries, supertagIds } = sourceEntries(
    resolveSource(rebaseTemplateSource(content, node, graph), node, graph, baseline),
  );
  const aliasContent = (nodeId: string, seen: ReadonlySet<string>): NodeContentInput => {
    const alias = graph.nodes[nodeId];
    if (!alias || seen.has(nodeId)) {
      throw new Error("The reference alias cannot be copied from its current source.");
    }
    const visited = new Set(seen).add(nodeId);
    return {
      items: alias.content.map((item) =>
        item.kind === "text"
          ? { kind: "text", value: item.value, attributes: item.attributes }
          : {
              kind: "inline-reference",
              targetNodeId: item.targetNodeId,
              sourceReferenceId: item.id,
              ...(item.aliasNodeId === null ? {} : { alias: aliasContent(item.aliasNodeId, visited) }),
            },
      ),
    };
  };
  const input: NodeContentInput = {
    items: entries.map((entry) =>
      entry.kind === "text"
        ? { kind: "text", value: entry.value, attributes: entry.attributes }
        : {
            kind: "inline-reference",
            targetNodeId: entry.data.targetNodeId,
            ...(entry.data.referenceId ? { sourceReferenceId: entry.data.referenceId } : {}),
            ...(entry.data.aliasNodeId ? { alias: aliasContent(entry.data.aliasNodeId, new Set()) } : {}),
          },
    ),
  };
  return { input, entries, supertagIds };
}

export function templateNodeInsertion(
  node: ProjectedNode,
  content: OutlineContent,
  graph: WorkspaceSnapshot,
  identity: Readonly<{ nodeId: string; occurrenceId: string }>,
  placement: "before" | "after" | "child",
): Extract<NodeEditIntent, { kind: "insert-node" }> {
  const { input, supertagIds } = templateNodeInput(node, content, graph, nodeSource(node, graph));
  return {
    kind: "insert-node",
    nodeId: identity.nodeId,
    occurrenceId: identity.occurrenceId,
    placement,
    content: input,
    supertagIds: [...supertagIds],
  };
}

export function templateNodeIntents(
  node: ProjectedNode,
  content: OutlineContent,
  graph: WorkspaceSnapshot,
  baseline: OutlineContent,
): readonly NodeEditIntent[] {
  const { input, entries, supertagIds } = templateNodeInput(node, content, graph, baseline);
  const current = sourceEntries(nodeSource(node, graph));
  const intents: NodeEditIntent[] =
    JSON.stringify(entries) === JSON.stringify(current.entries) ? [] : [{ kind: "set-content", content: input }];
  const existing = new Set((graph.supertagApplications[node.nodeId] ?? []).map((item) => item.supertagId));
  for (const supertagId of existing) {
    if (!supertagIds.has(supertagId)) {
      intents.push({ kind: "remove-supertag", supertagId });
    }
  }
  for (const supertagId of supertagIds) {
    if (!existing.has(supertagId)) {
      intents.push({ kind: "add-supertag", supertagId });
    }
  }
  return intents;
}
