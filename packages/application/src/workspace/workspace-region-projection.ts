import { contentToSource, type OutlineItemViewModel } from "@lode/ui";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import type { WorkspaceState } from "./workspace-controller.js";
import { projectWorkspaceOutline, type WorkspaceAppearance } from "./workspace-outline.js";
import { nodeLabel, nodeSource } from "./node-source.js";
import { workspaceNodeInTrash } from "./workspace-node-location.js";
import { nodeUsesSourceText } from "./workspace-field-policy.js";

export function workspaceRegionPath(key: string, scope: string): readonly string[] {
  const raw = scope ? key.slice(scope.length + 1) : key;
  try {
    const path: unknown = JSON.parse(raw);
    return Array.isArray(path) && path.every((part): part is string => typeof part === "string") ? path : [];
  } catch {
    return [];
  }
}

export type WorkspaceCollectionSource =
  | Readonly<{ kind: "children"; nodeId: string }>
  | Readonly<{ kind: "appearance"; occurrenceId: string }>
  | Readonly<{ kind: "node"; nodeId: string; structural?: boolean }>
  | Readonly<{ kind: "search-result"; nodeId: string; sourceIdentity: string }>
  | Readonly<{ kind: "field-values"; ownerNodeId: string; fieldDefinitionId: string }>
  | Readonly<{ kind: "template-default"; supertagId: string; templateFieldId: string }>;

export function projectWorkspaceRegion(
  graph: WorkspaceSnapshot,
  state: WorkspaceState,
  source: WorkspaceCollectionSource,
  scope: string,
) {
  let items: readonly OutlineItemViewModel<string>[] = [];
  const bindings = new Map<string, WorkspaceAppearance>();
  let rootNodeId = graph.rootNodeId;
  if (source.kind === "node" || source.kind === "search-result") {
    const node = graph.nodes[source.nodeId];
    rootNodeId = source.nodeId;
    if (node) {
      const path = [source.kind === "search-result" ? source.sourceIdentity : source.nodeId];
      const key = JSON.stringify(path);
      const children = projectWorkspaceOutline(graph, state.drafts, node.nodeId, state.insertions);
      const rebase = (item: OutlineItemViewModel<string>): OutlineItemViewModel<string> => {
        const binding = children.bindings.get(item.key)!;
        const nested = [...path, ...binding.path],
          key = JSON.stringify([...path, ...(binding.editingPath ?? binding.path)]);
        bindings.set(key, {
          ...binding,
          key,
          path: nested,
          editingPath: [...path, ...(binding.editingPath ?? binding.path)],
        });
        return { ...item, key, children: item.children?.map(rebase) };
      };
      const scalar = source.kind === "node" && source.structural === false;
      const editable = nodeUsesSourceText(graph, node.nodeId) && !workspaceNodeInTrash(graph, node.nodeId);
      items = [
        {
          key,
          presentation: key,
          accessibilityLabel: nodeLabel(node, graph) || "Empty node",
          content: state.drafts.get(node.nodeId)?.content ?? nodeSource(node, graph),
          editable,
          mergeable: false,
          capabilities:
            source.kind === "search-result" ? { insertSiblings: false, move: false, remove: false } : undefined,
          expandable: scalar ? false : undefined,
          children: scalar ? [] : children.items.map(rebase),
        },
      ];
      bindings.set(key, {
        ...(source.kind === "search-result"
          ? { kind: "search-result" as const, sourceIdentity: source.sourceIdentity }
          : { kind: "root" as const }),
        path,
        key,
        nodeId: node.nodeId,
        contentNodeId: node.nodeId,
        reference: false,
        editable,
      });
    }
  } else if (source.kind === "template-default") {
    const field = graph.templateFields[source.supertagId]?.find(
      (field) => field.factActionId === source.templateFieldId,
    );
    const node = field && graph.nodes[field.staticDefaultValueNodeId];
    if (field && node) {
      const key = JSON.stringify([field.staticDefaultValueOccurrenceId]);
      items = [
        {
          key,
          presentation: key,
          accessibilityLabel: nodeLabel(node, graph) || "Default value",
          content: state.drafts.get(node.nodeId)?.content ?? nodeSource(node, graph),
          expandable: false,
          mergeable: false,
        },
      ];
      bindings.set(key, {
        kind: "template-default",
        path: [field.staticDefaultValueOccurrenceId],
        key,
        nodeId: node.nodeId,
        contentNodeId: node.nodeId,
        supertagId: source.supertagId,
        templateFieldId: field.factActionId,
        editable: true,
        reference: false,
      });
    }
  } else {
    const field =
      source.kind === "field-values"
        ? graph.materializedFields[source.ownerNodeId]?.find(
            (field) => field.fieldDefinitionId === source.fieldDefinitionId,
          )
        : undefined;
    rootNodeId =
      source.kind === "children"
        ? source.nodeId
        : source.kind === "appearance"
          ? (graph.occurrences[source.occurrenceId]?.parentNodeId ?? graph.rootNodeId)
          : (field?.fieldNodeId ?? source.ownerNodeId);
    const projection = projectWorkspaceOutline(graph, state.drafts, rootNodeId, state.insertions);
    items =
      source.kind === "appearance"
        ? projection.items.filter((item) => projection.bindings.get(item.key)?.occurrenceId === source.occurrenceId)
        : source.kind === "field-values" && !field
          ? []
          : projection.items;
    for (const [key, binding] of projection.bindings) {
      bindings.set(key, binding);
    }
    if (source.kind === "field-values") {
      const pending = [...state.insertions.values()].filter(
        (item) =>
          item.destination.kind === "field" &&
          item.destination.ownerNodeId === source.ownerNodeId &&
          item.destination.fieldDefinitionId === source.fieldDefinitionId &&
          !graph.occurrences[item.occurrenceId],
      );
      const pendingItems = pending.map((item) => {
        const key = JSON.stringify([item.occurrenceId]),
          content = state.drafts.get(item.nodeId)?.content ?? [];
        const children = projectWorkspaceOutline(graph, state.drafts, item.nodeId, state.insertions);
        const rebase = (child: OutlineItemViewModel<string>): OutlineItemViewModel<string> => {
          const binding = children.bindings.get(child.key);
          if (!binding) {
            return child;
          }
          const path = [item.occurrenceId, ...binding.path],
            key = JSON.stringify(path);
          bindings.set(key, { ...binding, key, path });
          return { ...child, key, children: child.children?.map(rebase) };
        };
        bindings.set(key, {
          kind: "pending-value",
          path: [item.occurrenceId],
          key,
          occurrenceId: item.occurrenceId,
          nodeId: item.nodeId,
          contentNodeId: item.nodeId,
          reference: false,
          editable: true,
        });
        return {
          key,
          presentation: key,
          content,
          accessibilityLabel: contentToSource(content) || "Empty node",
          placeholder: !item.confirmed && contentToSource(content).length === 0,
          children: children.items.map(rebase),
        };
      });
      const ordered = [...items];
      pendingItems.forEach((item, index) => {
        const anchor = pending[index]!.anchor;
        const after = ordered.findIndex((candidate) => bindings.get(candidate.key)?.occurrenceId === anchor.after);
        const before = ordered.findIndex((candidate) => bindings.get(candidate.key)?.occurrenceId === anchor.before);
        ordered.splice(
          after >= 0 ? after + 1 : before >= 0 ? before : anchor.fallback === "start" ? 0 : ordered.length,
          0,
          item,
        );
      });
      items = ordered;
    }
  }
  const scopedBindings = new Map<string, WorkspaceAppearance>();
  const visit = (item: OutlineItemViewModel<string>): OutlineItemViewModel<string> => {
    const key = scope ? `${scope}:${item.key}` : item.key,
      binding = bindings.get(item.key);
    if (binding) {
      scopedBindings.set(key, { ...binding, key });
    }
    return { ...item, key, presentation: key, children: item.children?.map(visit) };
  };
  return { items: items.map(visit), bindings: scopedBindings, rootNodeId };
}
