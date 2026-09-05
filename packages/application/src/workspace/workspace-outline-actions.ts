import { projectWorkspaceOutline, type WorkspaceAppearance } from "./workspace-outline.js";
import { END_SEQUENCE_ANCHOR, type EditAction } from "@lode/sdk";
import {
  sliceContent,
  contentToSource,
  type OutlineClipboardItem,
  type OutlineContent,
  type OutlineMove,
  type OutlinePaste,
  type OutlineEditPosition,
  type OutlineMerge,
} from "@lode/ui";
import { nodeSource, nodeLabel, referenceToken } from "./node-source.js";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import type { WorkspaceController } from "./workspace-controller.js";
import { editNodeSource } from "./node-edit.js";
import { createNodeActions, removeAppearanceAction, replacementAnchor } from "./workspace-structure.js";

export function workspaceOutlineActions(
  graph: WorkspaceSnapshot,
  controller: WorkspaceController,
  appearances: ReadonlyMap<string, WorkspaceAppearance>,
  rootNodeId: string,
) {
  const id = (key: string) => appearances.get(key)?.occurrenceId ?? "";
  const remove = (keys: readonly string[]) => {
    void controller.apply((current) => {
      return [...new Set(keys.map(id))].flatMap((occurrenceId): EditAction[] => {
        const occurrence = current.occurrences[occurrenceId];
        if (!occurrence) {
          return [];
        }
        return [removeAppearanceAction(current, occurrenceId)];
      });
    });
  };
  const move = async (move: OutlineMove) => {
    const parentNodeId =
      move.targetParentKey === null ? rootNodeId : graph.occurrences[id(move.targetParentKey)]?.nodeId;
    if (!parentNodeId) {
      return null;
    }
    const sources = [...new Set(move.sourceKeys.map(id))];
    const applied = await controller.apply((current) => {
      const siblings = (current.childOccurrences[parentNodeId] ?? []).filter((key) => !sources.includes(key));
      const anchor = { ...END_SEQUENCE_ANCHOR, before: siblings[move.index] ?? null };
      return sources.map((occurrenceId) => ({ kind: "occurrence-move", occurrenceId, parentNodeId, anchor }));
    });
    if (!applied) {
      return null;
    }
    const destination = move.targetParentKey === null ? [] : (JSON.parse(move.targetParentKey) as string[]);
    const keyMap = new Map<string, string>();
    for (const source of move.sourceKeys) {
      const sourcePath = JSON.parse(source) as string[];
      for (const key of appearances.keys()) {
        const path = JSON.parse(key) as string[];
        if (sourcePath.every((part, index) => path[index] === part)) {
          keyMap.set(key, JSON.stringify([...destination, ...path.slice(sourcePath.length - 1)]));
        }
      }
    }
    return { keyMap };
  };
  const copy = (keys: readonly string[]): readonly OutlineClipboardItem[] => {
    const visit = (occurrenceId: string, visited: ReadonlySet<string>): OutlineClipboardItem[] => {
      const occurrence = graph.occurrences[occurrenceId];
      const node = occurrence && graph.nodes[occurrence.nodeId];
      if (!node) {
        return [];
      }
      return [
        {
          content: nodeSource(node, graph),
          data: { workspaceId: controller.workspaceId, nodeId: node.nodeId },
          children: visited.has(node.nodeId)
            ? []
            : (graph.childOccurrences[node.nodeId] ?? []).flatMap((key) =>
                visit(key, new Set(visited).add(node.nodeId)),
              ),
        },
      ];
    };
    return keys.flatMap((key) => visit(id(key), new Set()));
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
  const paste = (key: string | null, paste: OutlinePaste) => {
    const occurrence = key === null ? undefined : graph.occurrences[id(key)];
    const referenced = paste.items.length === 1 ? copiedTarget(paste.items[0]!, graph) : undefined;
    const host = occurrence && graph.nodes[occurrence.nodeId];
    if (key !== null && occurrence && host && referenced) {
      const content = controller.getSnapshot().drafts.get(host.nodeId)?.content ?? nodeSource(host, graph);
      if (contentToSource(content).length > 0) {
        const token = referenceToken(
          { kind: "reference", targetNodeId: referenced.nodeId },
          nodeLabel(referenced, graph),
        );
        controller.stageNode(occurrence.nodeId, [
          ...sliceContent(content, 0, paste.selection.from),
          token,
          ...sliceContent(content, paste.selection.to, contentToSource(content).length),
        ]);
        controller.flush();
        return { key, caret: paste.selection.from + token.source.length };
      }
    }
    const parentNodeId = occurrence
      ? paste.placement === "child"
        ? occurrence.nodeId
        : occurrence.parentNodeId
      : rootNodeId;
    const path = key === null ? [] : (JSON.parse(key) as string[]);
    const parentPath = paste.placement === "child" ? path : path.slice(0, -1);
    const byTarget = new Map<string, string>();
    const occurrenceIds = paste.items.map((item) => {
      const target = copiedTarget(item, graph);
      if (!target) {
        return crypto.randomUUID();
      }
      const existing = (graph.childOccurrences[parentNodeId] ?? []).find(
        (key) => graph.occurrences[key]?.nodeId === target.nodeId,
      );
      const result = existing ?? byTarget.get(target.nodeId) ?? crypto.randomUUID();
      byTarget.set(target.nodeId, result);
      return result;
    });
    void controller.apply((current) => {
      const anchor =
        paste.replaceEmpty && occurrence
          ? { ...replacementAnchor(current, occurrence.occurrenceId) }
          : { ...END_SEQUENCE_ANCHOR, after: paste.placement === "after" ? (occurrence?.occurrenceId ?? null) : null };
      const inserted = new Set<string>();
      const actions = paste.items.flatMap((item, index): readonly EditAction[] => {
        const target = copiedTarget(item, current);
        const identity = { nodeId: crypto.randomUUID(), occurrenceId: occurrenceIds[index]! };
        if (
          inserted.has(identity.occurrenceId) ||
          (target && current.occurrences[identity.occurrenceId]?.nodeId === target.nodeId)
        ) {
          return [];
        }
        inserted.add(identity.occurrenceId);
        const result: EditAction[] = target
          ? [
              {
                kind: "occurrence-create",
                nodeId: target.nodeId,
                occurrenceId: identity.occurrenceId,
                parentNodeId,
                anchor: { ...anchor },
              },
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
    return occurrenceIds[0] ? { key: JSON.stringify([...parentPath, occurrenceIds[0]]), caret: 0 } : null;
  };
  const createRoot = (content: OutlineContent) => {
    const identity = { nodeId: crypto.randomUUID(), occurrenceId: crypto.randomUUID() };
    void controller.apply((current) => createNodeActions(current, rootNodeId, content, END_SEQUENCE_ANCHOR, identity));
    return { key: JSON.stringify([identity.occurrenceId]), caret: 0 };
  };
  const history = async (direction: "undo" | "redo", position: OutlineEditPosition | null) => {
    const occurrenceId = position ? appearances.get(position.key)?.occurrenceId : undefined;
    if (!(await controller.history(direction))) {
      return null;
    }
    const current = controller.getSnapshot().graph;
    if (!current) {
      return { position: null };
    }
    const visible = projectWorkspaceOutline(current, controller.getSnapshot().drafts, rootNodeId).bindings;
    const matching = [...visible.values()].find((binding) => binding.occurrenceId === occurrenceId);
    if (matching && position) {
      return { position: { ...position, key: matching.key } };
    }
    const previous = occurrenceId ? graph.occurrences[occurrenceId] : undefined;
    const index = previous ? (graph.childOccurrences[previous.parentNodeId] ?? []).indexOf(previous.occurrenceId) : -1;
    const replacementId = previous ? current.childOccurrences[previous.parentNodeId]?.[Math.max(0, index)] : undefined;
    const replacement = [...visible.values()].find((binding) => binding.occurrenceId === replacementId);
    return {
      position: replacement
        ? { key: replacement.key, caret: 0, editing: !replacement.reference && replacement.editable }
        : null,
    };
  };
  const clear = (key: string) => {
    const binding = appearances.get(key);
    if (!binding || !binding.editable) {
      return null;
    }
    const occurrence = graph.occurrences[binding.occurrenceId];
    if (!occurrence) {
      return null;
    }
    const identity = { nodeId: crypto.randomUUID(), occurrenceId: crypto.randomUUID() };
    void controller.apply((current) => [
      ...createNodeActions(
        current,
        occurrence.parentNodeId,
        [],
        replacementAnchor(current, occurrence.occurrenceId),
        identity,
      ),
      removeAppearanceAction(current, occurrence.occurrenceId),
    ]);
    const path = JSON.parse(key) as string[];
    return { key: JSON.stringify([...path.slice(0, -1), identity.occurrenceId]), caret: 0 };
  };
  const merge = (merge: OutlineMerge) => {
    const source = appearances.get(merge.sourceKey),
      target = appearances.get(merge.targetKey);
    if (!source || !target || !target.editable || source.reference || target.reference) {
      return;
    }
    void controller.apply((current) => {
      const node = current.nodes[target.contentNodeId];
      if (!node) {
        throw new Error("The merge destination is no longer available");
      }
      return [...editNodeSource(node, merge.content, current), removeAppearanceAction(current, source.occurrenceId)];
    });
  };
  return { remove, move, copy, paste, createRoot, history, clear, merge };
}
function copyBranch(graph: WorkspaceSnapshot, parentNodeId: string, item: OutlineClipboardItem): readonly EditAction[] {
  const identity = { nodeId: crypto.randomUUID(), occurrenceId: crypto.randomUUID() };
  return [
    ...createNodeActions(graph, parentNodeId, item.content, END_SEQUENCE_ANCHOR, identity),
    ...item.children.flatMap((child) => copyBranch(graph, identity.nodeId, child)),
  ];
}
