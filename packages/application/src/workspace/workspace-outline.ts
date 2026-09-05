import type { OutlineContent, OutlineItemViewModel } from "@lode/ui";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import { nodeLabel, nodeSource } from "./node-source.js";

export type WorkspaceAppearance = Readonly<{
  key: string;
  occurrenceId: string;
  nodeId: string;
  contentNodeId: string;
  reference: boolean;
  editable: boolean;
}>;
/** The appearance owns structure; its editable name can belong to another Node. */
export function projectWorkspaceOutline(
  graph: WorkspaceSnapshot,
  drafts: ReadonlyMap<string, Readonly<{ content: OutlineContent }>>,
  rootNodeId: string,
) {
  const bindings = new Map<string, WorkspaceAppearance>();
  const fields = new Map(
    Object.values(graph.materializedFields)
      .flat()
      .map((field) => [field.fieldNodeId, field]),
  );
  const linkedTemplates = new Set(
    graph.templateNodeInstances
      .filter((instance) => instance.state === "linked")
      .map((instance) => instance.instanceOccurrenceId),
  );
  const build = (
    parent: string,
    ancestors: ReadonlySet<string>,
    path: readonly string[] = [],
  ): readonly OutlineItemViewModel<string>[] =>
    (fields.get(parent)?.valueOccurrenceIds ?? graph.childOccurrences[parent] ?? []).flatMap((occurrenceId) => {
      const occurrence = graph.occurrences[occurrenceId];
      const node = occurrence && graph.nodes[occurrence.nodeId];
      if (!node || graph.systemNodeIds.includes(node.nodeId)) {
        return [];
      }
      const field = fields.get(node.nodeId);
      const contentNode = field ? graph.nodes[field.fieldDefinitionId] : node;
      if (!contentNode) {
        return [];
      }
      const key = JSON.stringify([...path, occurrenceId]);
      const reference = graph.nodeOwners[node.nodeId] !== occurrence.parentNodeId;
      const borrowedName = field !== undefined && graph.nodeOwners[contentNode.nodeId] !== field.fieldNodeId;
      const inherited = linkedTemplates.has(occurrenceId);
      const editable = !borrowedName && !inherited;
      bindings.set(key, {
        key,
        occurrenceId,
        nodeId: node.nodeId,
        contentNodeId: contentNode.nodeId,
        reference,
        editable,
      });
      return [
        {
          key,
          presentation: occurrenceId,
          content: drafts.get(contentNode.nodeId)?.content ?? nodeSource(contentNode, graph),
          accessibilityLabel: nodeLabel(contentNode, graph) || "Empty node",
          editable,
          mergeable: field === undefined && !reference && !inherited,
          activation: reference && field === undefined ? "object" : "text",
          readonlyReason: borrowedName
            ? "Name belongs to the field definition"
            : inherited
              ? "Inherited template content"
              : undefined,
          expandable: field || ancestors.has(node.nodeId) ? false : undefined,
          children: ancestors.has(node.nodeId)
            ? []
            : build(node.nodeId, new Set(ancestors).add(node.nodeId), [...path, occurrenceId]),
        },
      ];
    });
  return { items: build(rootNodeId, new Set([rootNodeId])), bindings, fields };
}
