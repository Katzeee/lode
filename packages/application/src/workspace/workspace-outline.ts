import { contentToSource, type OutlineContent, type OutlineItemViewModel } from "@lode/ui";
import type { FactActionId, TemplateNodeInstance } from "@lode/sdk";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import {
  workspaceContentKey,
  workspaceTemplateOccurrence,
  type WorkspaceContentTarget,
} from "./workspace-content-target.js";
import type { WorkspaceDraftState } from "./workspace-drafts.js";
import { workspaceNodeInTrash } from "./workspace-node-location.js";
import { nodeLabel, nodeSource } from "./node-source.js";
import { nodeUsesSourceText } from "./workspace-field-policy.js";

export type WorkspaceAppearance = Readonly<{
  key: string;
  path: readonly string[];
  editingPath?: readonly string[];
  contentTarget?: WorkspaceContentTarget;
  nodeId: string;
  contentNodeId: string;
  reference: boolean;
  editable: boolean;
}> &
  (
    | Readonly<{ kind: "occurrence" | "pending-value"; occurrenceId: string }>
    | Readonly<{ kind: "root"; occurrenceId?: never }>
    | Readonly<{ kind: "search-result"; occurrenceId?: never; sourceIdentity: string }>
    | Readonly<{
        kind: "template-default";
        occurrenceId?: never;
        supertagId: string;
        templateFieldId: FactActionId;
      }>
  );
/** The appearance owns structure; its editable name can belong to another Node. */
export function projectWorkspaceOutline(
  graph: WorkspaceSnapshot,
  drafts: ReadonlyMap<string, Readonly<{ content: OutlineContent }>>,
  rootNodeId: string,
  insertions: WorkspaceDraftState["insertions"] = new Map(),
) {
  const bindings = new Map<string, WorkspaceAppearance>();
  if (graph.nodes[rootNodeId]) {
    bindings.set(`title:${rootNodeId}`, {
      kind: "root",
      path: [],
      key: `title:${rootNodeId}`,
      nodeId: rootNodeId,
      contentNodeId: rootNodeId,
      reference: false,
      editable: true,
    });
  }
  const fields = new Map(
    Object.values(graph.materializedFields)
      .flat()
      .map((field) => [field.fieldNodeId, field]),
  );
  const templateInstances = new Map(
    graph.templateNodeInstances.map((instance) => [instance.instanceOccurrenceId, instance]),
  );
  type Context = Readonly<{ instance: TemplateNodeInstance; sourcePath: readonly string[] }>;
  const pendingContent = new Map(
    [...insertions.values()].flatMap((insertion) =>
      insertion.destination.kind === "template" && insertion.destination.before
        ? [[workspaceContentKey(insertion.destination.target), insertion.destination.before] as const]
        : [],
    ),
  );
  const childIds = (parent: string, context?: Context): readonly string[] => {
    const ids = [...(fields.get(parent)?.valueOccurrenceIds ?? graph.childOccurrences[parent] ?? [])];
    for (const insertion of insertions.values()) {
      const destination = insertion.destination;
      const target = insertion.context;
      if (
        !target ||
        (destination.kind !== "template" && destination.kind !== "relative") ||
        ids.includes(insertion.occurrenceId) ||
        graph.occurrences[insertion.occurrenceId]?.parentNodeId !== parent
      ) {
        continue;
      }
      if (
        !context ||
        context.instance.ownerNodeId !== target.ownerNodeId ||
        context.instance.templateNodeId !== target.templateNodeId ||
        JSON.stringify(context.sourcePath) !== JSON.stringify(target.sourcePath)
      ) {
        continue;
      }
      const { placement } = destination;
      const anchor =
        destination.kind === "template"
          ? workspaceTemplateOccurrence(destination.target, graph)
          : destination.occurrenceId;
      const index = placement === "child" ? 0 : ids.indexOf(anchor ?? "") + (placement === "after" ? 1 : 0);
      ids.splice(Math.max(0, index), 0, insertion.occurrenceId);
    }
    return ids;
  };
  const build = (
    parent: string,
    ancestors: ReadonlySet<string>,
    path: readonly string[] = [],
    editingPath: readonly string[] = [],
    context?: Context,
  ): readonly OutlineItemViewModel<string>[] =>
    childIds(parent, context).flatMap((occurrenceId) => {
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
      const placeholder =
        insertions.has(node.nodeId) &&
        !insertions.get(node.nodeId)?.confirmed &&
        contentToSource(drafts.get(node.nodeId)?.content ?? []).length === 0;
      const instance = templateInstances.get(occurrenceId);
      const currentContext =
        instance && instance.state !== "reference"
          ? { instance, sourcePath: [] as readonly string[] }
          : context && !insertions.has(node.nodeId) && graph.nodeOwners[node.nodeId] === parent
            ? {
                instance: context.instance,
                sourcePath:
                  context.instance.state === "linked"
                    ? [...context.sourcePath, occurrenceId]
                    : context.instance.copies.find((copy) => copy.instanceOccurrenceId === occurrenceId)?.sourcePath,
              }
            : undefined;
      const contentTarget: WorkspaceContentTarget | undefined =
        currentContext?.sourcePath && !field
          ? {
              kind: "template-instance",
              ownerNodeId: currentContext.instance.ownerNodeId,
              templateNodeId: currentContext.instance.templateNodeId,
              sourcePath: currentContext.sourcePath,
            }
          : undefined;
      const contextKey = currentContext?.sourcePath
        ? workspaceContentKey({
            kind: "template-instance",
            ownerNodeId: currentContext.instance.ownerNodeId,
            templateNodeId: currentContext.instance.templateNodeId,
            sourcePath: currentContext.sourcePath,
          })
        : undefined;
      const sourcePath = [...editingPath, contextKey ?? occurrenceId];
      const key = JSON.stringify(sourcePath);
      const reference =
        instance?.state === "linked" ? false : graph.nodeOwners[node.nodeId] !== occurrence.parentNodeId;
      const borrowedName = field !== undefined && graph.nodeOwners[contentNode.nodeId] !== field.fieldNodeId;
      const inherited = currentContext?.instance.state === "linked";
      const sharedFieldName = !!field && !!currentContext;
      const inTrash = workspaceNodeInTrash(graph, contentNode.nodeId);
      const editable = !inTrash && !borrowedName && !sharedFieldName && nodeUsesSourceText(graph, contentNode.nodeId);
      bindings.set(key, {
        kind: "occurrence",
        path: [...path, occurrenceId],
        editingPath: sourcePath,
        contentTarget,
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
          content:
            (contentTarget ? pendingContent.get(workspaceContentKey(contentTarget)) : undefined) ??
            drafts.get(contentTarget ? workspaceContentKey(contentTarget) : contentNode.nodeId)?.content ??
            nodeSource(contentNode, graph),
          accessibilityLabel: nodeLabel(contentNode, graph) || "Empty node",
          placeholder,
          editable,
          capabilities: inherited
            ? { insertChildren: !field, insertSiblings: !field, move: false, remove: false }
            : !nodeUsesSourceText(graph, contentNode.nodeId)
              ? { insertSiblings: false }
              : undefined,
          mergeable: field === undefined && !reference && !inherited,
          endInsertion:
            inherited &&
            currentContext?.sourcePath?.length === 0 &&
            (graph.childOccurrences[node.nodeId]?.length ?? 0) > 0
              ? "child"
              : undefined,
          activation: reference && field === undefined ? "object" : "text",
          readonlyReason: inTrash
            ? "The node is in the trash"
            : borrowedName || sharedFieldName
              ? "Name belongs to the field definition"
              : !editable
                ? "This value type is not editable in a text surface"
                : undefined,
          expandable: placeholder || field || ancestors.has(node.nodeId) ? false : undefined,
          children: ancestors.has(node.nodeId)
            ? []
            : build(
                node.nodeId,
                new Set(ancestors).add(node.nodeId),
                [...path, occurrenceId],
                sourcePath,
                currentContext?.sourcePath
                  ? { instance: currentContext.instance, sourcePath: currentContext.sourcePath }
                  : undefined,
              ),
        },
      ];
    });
  return { items: build(rootNodeId, new Set([rootNodeId])), bindings, fields };
}
