import { END_SEQUENCE_ANCHOR, type EditAction } from "@lode/sdk";
import { sliceContent, contentToSource, type OutlineClipboardItem, type OutlinePaste } from "@lode/ui";
import { nodeSource, nodeLabel, referenceToken } from "./node-source.js";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import type { WorkspaceController } from "./workspace-controller.js";
import type { WorkspaceAppearance } from "./workspace-outline.js";
import { createNodeActions, removeAppearanceAction, replacementAnchor } from "./workspace-structure.js";
import { editNodeSource } from "./node-edit.js";

export function workspaceClipboard(
  graph: WorkspaceSnapshot,
  controller: WorkspaceController,
  appearances: ReadonlyMap<string, WorkspaceAppearance>,
  rootNodeId: string,
  keyForPath: (path: readonly string[]) => string,
) {
  const id = (key: string) => appearances.get(key)?.occurrenceId ?? "";
  const copy = (keys: readonly string[], operation: "copy" | "cut"): readonly OutlineClipboardItem[] => {
    const visit = (occurrenceId: string, visited: ReadonlySet<string>): OutlineClipboardItem[] => {
      const occurrence = graph.occurrences[occurrenceId];
      const node = occurrence && graph.nodes[occurrence.nodeId];
      if (!node) {
        return [];
      }
      return [
        {
          content: nodeSource(node, graph),
          data: {
            workspaceId: controller.workspaceId,
            nodeId: node.nodeId,
            operation,
            occurrenceId,
            original: graph.nodeOwners[node.nodeId] === occurrence.parentNodeId,
          },
          children: visited.has(node.nodeId)
            ? []
            : (graph.childOccurrences[node.nodeId] ?? []).flatMap((key) =>
                visit(key, new Set(visited).add(node.nodeId)),
              ),
        },
      ];
    };
    return keys.flatMap((key) => {
      const binding = appearances.get(key),
        node = binding && graph.nodes[binding.contentNodeId];
      if (binding && !binding.occurrenceId && node) {
        return [
          {
            content: nodeSource(node, graph),
            data: { workspaceId: controller.workspaceId, nodeId: node.nodeId, operation: "copy" },
            children: (graph.childOccurrences[node.nodeId] ?? []).flatMap((key) => visit(key, new Set([node.nodeId]))),
          },
        ];
      }
      return visit(id(key), new Set());
    });
  };
  const copiedTarget = (item: OutlineClipboardItem, current: WorkspaceSnapshot) => {
    const data = item.data;
    return typeof data === "object" &&
      data !== null &&
      "workspaceId" in data &&
      data.workspaceId === controller.workspaceId &&
      "nodeId" in data &&
      typeof data.nodeId === "string"
      ? current.nodes[data.nodeId]
      : undefined;
  };
  const cutAppearance = (item: OutlineClipboardItem, current: WorkspaceSnapshot) => {
    const data = item.data;
    const target = copiedTarget(item, current);
    if (
      !target ||
      typeof data !== "object" ||
      data === null ||
      !("operation" in data) ||
      data.operation !== "cut" ||
      !("occurrenceId" in data) ||
      typeof data.occurrenceId !== "string" ||
      !("original" in data) ||
      typeof data.original !== "boolean"
    ) {
      return null;
    }
    const occurrence = current.occurrences[data.occurrenceId];
    if (data.original) {
      return current.nodeOwners[target.nodeId] === current.workspaceSystemNodes.trash &&
        occurrence?.nodeId === target.nodeId
        ? { occurrenceId: data.occurrenceId, original: true }
        : null;
    }
    return occurrence === undefined ? { occurrenceId: data.occurrenceId, original: false } : null;
  };
  const paste = (key: string | null, paste: OutlinePaste) => {
    const appearance = key === null ? undefined : appearances.get(key);
    const occurrence = appearance?.occurrenceId ? graph.occurrences[appearance.occurrenceId] : undefined;
    const referenced = paste.items.length === 1 ? copiedTarget(paste.items[0]!, graph) : undefined;
    const host = appearance && graph.nodes[appearance.contentNodeId];
    if (key !== null && host && referenced) {
      const content = controller.getSnapshot().drafts.get(host.nodeId)?.content ?? nodeSource(host, graph);
      if (contentToSource(content).length > 0) {
        const token = referenceToken(
          { kind: "reference", targetNodeId: referenced.nodeId },
          nodeLabel(referenced, graph),
        );
        const nextContent = [
          ...sliceContent(content, 0, paste.selection.from),
          token,
          ...sliceContent(content, paste.selection.to, contentToSource(content).length),
        ];
        controller.stageNode(host.nodeId, nextContent);
        controller.flush();
        return { key, caret: paste.selection.from + token.source.length };
      }
    }
    const parentNodeId = occurrence
      ? paste.placement === "child"
        ? occurrence.nodeId
        : occurrence.parentNodeId
      : rootNodeId;
    const pending =
      appearance && paste.replaceEmpty ? controller.getSnapshot().insertions.get(appearance.contentNodeId) : undefined;
    const deferred =
      pending &&
      !pending.confirmed &&
      contentToSource(controller.getSnapshot().drafts.get(pending.nodeId)?.content ?? []).length === 0
        ? pending
        : undefined;
    const path = key === null ? [] : (appearances.get(key)?.path ?? []);
    const parentPath = paste.placement === "child" ? path : path.slice(0, -1);
    const byTarget = new Map<string, string>();
    const occurrenceIds = paste.items.map((item) => {
      const target = copiedTarget(item, graph);
      if (!target) {
        return crypto.randomUUID();
      }
      const existing = (
        deferred?.destination.kind === "field" ? [] : (graph.childOccurrences[parentNodeId] ?? [])
      ).find((key) => graph.occurrences[key]?.nodeId === target.nodeId);
      const cut = cutAppearance(item, graph);
      const result = existing ?? byTarget.get(target.nodeId) ?? cut?.occurrenceId ?? crypto.randomUUID();
      byTarget.set(target.nodeId, result);
      return result;
    });
    if (deferred) {
      controller.discardPlaceholder(deferred.nodeId);
    }
    void controller.apply((current) => {
      const occurrence = appearance?.occurrenceId ? current.occurrences[appearance.occurrenceId] : undefined;
      const parentNodeId = occurrence
        ? paste.placement === "child"
          ? occurrence.nodeId
          : occurrence.parentNodeId
        : deferred?.destination.kind === "children"
          ? deferred.destination.parentNodeId
          : rootNodeId;
      const field =
        deferred?.destination.kind === "field"
          ? deferred.destination
          : Object.values(current.materializedFields)
              .flat()
              .find((field) => field.fieldNodeId === parentNodeId);
      const anchor = deferred
        ? { ...deferred.anchor }
        : paste.replaceEmpty && occurrence
          ? { ...replacementAnchor(current, occurrence.occurrenceId) }
          : { ...END_SEQUENCE_ANCHOR, after: paste.placement === "after" ? (occurrence?.occurrenceId ?? null) : null };
      const inserted = new Set<string>();
      const actions = paste.items.flatMap((item, index): readonly EditAction[] => {
        const target = copiedTarget(item, current);
        const identity = { nodeId: crypto.randomUUID(), occurrenceId: occurrenceIds[index]! };
        const cut = cutAppearance(item, current);
        if (
          inserted.has(identity.occurrenceId) ||
          (target && current.occurrences[identity.occurrenceId]?.nodeId === target.nodeId && !cut?.original)
        ) {
          return [];
        }
        inserted.add(identity.occurrenceId);
        const result: EditAction[] = target
          ? cut?.original
            ? [
                {
                  kind: "node-restore",
                  nodeId: target.nodeId,
                  occurrenceId: identity.occurrenceId,
                  destination: field
                    ? { kind: "field", ownerNodeId: field.ownerNodeId, fieldDefinitionId: field.fieldDefinitionId }
                    : { kind: "node", nodeId: parentNodeId },
                  anchor: { ...anchor },
                },
              ]
            : field
              ? [
                  {
                    kind: "field-value-create",
                    ownerNodeId: field.ownerNodeId,
                    fieldDefinitionId: field.fieldDefinitionId,
                    valueNodeId: target.nodeId,
                    valueOccurrenceId: identity.occurrenceId,
                    anchor: { ...anchor },
                  },
                ]
              : [
                  {
                    kind: "occurrence-create",
                    nodeId: target.nodeId,
                    occurrenceId: identity.occurrenceId,
                    parentNodeId,
                    anchor: { ...anchor },
                  },
                ]
          : field
            ? [
                {
                  kind: "field-value-create",
                  ownerNodeId: field.ownerNodeId,
                  fieldDefinitionId: field.fieldDefinitionId,
                  valueNodeId: identity.nodeId,
                  valueOccurrenceId: identity.occurrenceId,
                  anchor: { ...anchor },
                },
                ...editNodeSource(
                  { nodeId: identity.nodeId, content: [], intrinsicNodeType: null },
                  item.content,
                  current,
                ),
              ]
            : [...createNodeActions(current, parentNodeId, item.content, { ...anchor }, identity)];
        if (!target) {
          for (const child of item.children) {
            result.push(...copyBranch(current, identity.nodeId, child));
          }
        }
        anchor.after = identity.occurrenceId;
        return result;
      });
      if (
        paste.replaceEmpty &&
        occurrence &&
        !occurrenceIds.includes(occurrence.occurrenceId) &&
        (current.nodes[occurrence.nodeId]?.content.length ?? 0) === 0
      ) {
        actions.push(removeAppearanceAction(current, occurrence.occurrenceId));
      }
      return actions;
    });
    const last = occurrenceIds.at(-1),
      item = paste.items.at(-1);
    return last && item
      ? { key: keyForPath([...parentPath, last]), caret: contentToSource(item.content).length }
      : null;
  };
  return { copy, paste };
}

function copyBranch(graph: WorkspaceSnapshot, parentNodeId: string, item: OutlineClipboardItem): readonly EditAction[] {
  const identity = { nodeId: crypto.randomUUID(), occurrenceId: crypto.randomUUID() };
  return [
    ...createNodeActions(graph, parentNodeId, item.content, END_SEQUENCE_ANCHOR, identity),
    ...item.children.flatMap((child) => copyBranch(graph, identity.nodeId, child)),
  ];
}
