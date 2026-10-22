import { workspaceMovement } from "./workspace-movement.js";
import { workspaceClipboard } from "./workspace-clipboard.js";
import { projectWorkspaceOutline, type WorkspaceAppearance } from "./workspace-outline.js";
import { type EditAction } from "@lode/sdk";
import { type OutlineContent, type OutlineEditPosition, type OutlineMerge } from "@lode/ui";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import type { WorkspaceController } from "./workspace-controller.js";
import { editNodeSource } from "./node-edit.js";
import { createNodeActions, removeAppearanceAction, replacementAnchor } from "./workspace-structure.js";

export function workspaceOutlineActions(
  graph: WorkspaceSnapshot,
  controller: WorkspaceController,
  appearances: ReadonlyMap<string, WorkspaceAppearance>,
  rootNodeId: string,
  keyForPath: (path: readonly string[]) => string = JSON.stringify,
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
  const move = workspaceMovement(controller, appearances, rootNodeId, keyForPath);
  const { copy, paste } = workspaceClipboard(graph, controller, appearances, rootNodeId, keyForPath);
  const createRoot = (content: OutlineContent) => {
    const identity = controller.prepare(rootNodeId, content);
    return { key: keyForPath([identity.occurrenceId]), caret: 0 };
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
    const appearance = position && appearances.get(position.key);
    if (appearance && !appearance.occurrenceId) {
      return { position: current.nodes[appearance.contentNodeId] ? position : null };
    }
    const visible = projectWorkspaceOutline(current, controller.getSnapshot().drafts, rootNodeId).bindings;
    const matching = [...visible.values()].find(
      (binding) =>
        (appearance?.contentTarget &&
          binding.contentTarget &&
          JSON.stringify(appearance.contentTarget) === JSON.stringify(binding.contentTarget)) ||
        binding.occurrenceId === occurrenceId,
    );
    if (matching && position) {
      return { position: { ...position, key: keyForPath(matching.editingPath ?? matching.path) } };
    }
    const previous = occurrenceId ? graph.occurrences[occurrenceId] : undefined;
    const index = previous ? (graph.childOccurrences[previous.parentNodeId] ?? []).indexOf(previous.occurrenceId) : -1;
    const replacementId = previous ? current.childOccurrences[previous.parentNodeId]?.[Math.max(0, index)] : undefined;
    const replacement = [...visible.values()].find((binding) => binding.occurrenceId === replacementId);
    return {
      position: replacement
        ? {
            key: keyForPath(replacement.editingPath ?? replacement.path),
            caret: 0,
            editing: !replacement.reference && replacement.editable,
          }
        : null,
    };
  };
  const clear = (key: string) => {
    const binding = appearances.get(key);
    if (!binding || !binding.editable) {
      return null;
    }
    const occurrence = graph.occurrences[binding.occurrenceId ?? ""];
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
    const path = binding.path;
    return { key: keyForPath([...path.slice(0, -1), identity.occurrenceId]), caret: 0 };
  };
  const merge = (merge: OutlineMerge) => {
    const source = appearances.get(merge.sourceKey),
      target = appearances.get(merge.targetKey);
    if (!source?.occurrenceId || !target || !target.editable || source.reference || target.reference) {
      return;
    }
    void controller.apply(
      (current) => {
        const node = current.nodes[target.contentNodeId];
        if (!node) {
          throw new Error("The merge destination is no longer available");
        }
        return [...editNodeSource(node, merge.content, current), removeAppearanceAction(current, source.occurrenceId)];
      },
      new Map([[target.contentNodeId, merge.content]]),
    );
  };
  return { remove, move, copy, paste, createRoot, history, clear, merge };
}
