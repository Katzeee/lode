import { END_SEQUENCE_ANCHOR, type EditAction } from "@lode/sdk";
import { flattenOutline, resolveOutlineMove, type OutlineMove, type OutlineMoveDestination } from "@lode/ui";
import { projectWorkspaceOutline, type WorkspaceAppearance } from "./workspace-outline.js";
import type { WorkspaceSnapshot } from "./workspace-model.js";
import type { WorkspaceController } from "./workspace-controller.js";

export function workspaceMovement(
  controller: WorkspaceController,
  appearances: ReadonlyMap<string, WorkspaceAppearance>,
  rootNodeId: string,
  keyForPath: (path: readonly string[]) => string,
) {
  return async (intent: OutlineMove) => {
    const originals = intent.sourceKeys.map((key) => appearances.get(key));
    if (originals.some((item) => !item?.occurrenceId)) {
      return null;
    }
    const sources = [...new Set(originals.flatMap((item) => (item?.occurrenceId ? [item.occurrenceId] : [])))];
    const originalParent =
      intent.kind === "absolute" && intent.targetParentKey !== null
        ? appearances.get(intent.targetParentKey)
        : undefined;
    const pendingParent =
      originalParent &&
      [...controller.getSnapshot().insertions.values()].find((item) => item.nodeId === originalParent.nodeId);
    const resolved: { path: readonly string[] | null } = { path: null };
    const mappings = originals.flatMap((source) => (source ? [{ source, appearances }] : []));
    const applied = await controller.apply(
      (current) => {
        const projection = projectWorkspaceOutline(current, controller.getSnapshot().drafts, rootNodeId);
        const currentSources = originals.map((item) => currentAppearance(projection.bindings, item!));
        if (currentSources.some((item) => !item)) {
          return [];
        }
        const parent = originalParent ? currentAppearance(projection.bindings, originalParent) : undefined;
        if (originalParent && !parent) {
          return [];
        }
        const request: OutlineMove =
          intent.kind === "relative"
            ? { ...intent, sourceKeys: currentSources.map((item) => item!.key) }
            : { ...intent, sourceKeys: currentSources.map((item) => item!.key), targetParentKey: parent?.key ?? null };
        const move = resolveOutlineMove(flattenOutline(projection.items, new Set(projection.bindings.keys())), request);
        if (!move) {
          return [];
        }
        const target = move.targetParentKey === null ? undefined : projection.bindings.get(move.targetParentKey);
        const parentNodeId = target?.nodeId ?? rootNodeId;
        resolved.path = target?.path ?? [];
        const before = new Map(
          [...projection.bindings.values()].map((item) => [keyForPath(item.editingPath ?? item.path), item]),
        );
        mappings.push(...currentSources.flatMap((source) => (source ? [{ source, appearances: before }] : [])));
        const orderedSources = move.sourceKeys.flatMap((key) => {
          const occurrenceId = projection.bindings.get(key)?.occurrenceId;
          return occurrenceId ? [occurrenceId] : [];
        });
        return movementActions(current, orderedSources, parentNodeId, move);
      },
      undefined,
      pendingParent ? [...sources, pendingParent.occurrenceId] : sources,
    );
    const destination = resolved.path;
    if (!applied || destination === null) {
      return null;
    }
    const graph = controller.viewGraph();
    if (!graph) {
      return null;
    }
    const current = projectWorkspaceOutline(graph, controller.getSnapshot().drafts, rootNodeId).bindings;
    const keyMap = new Map<string, string>();
    for (const { source, appearances: before } of mappings) {
      for (const [key, appearance] of before) {
        if (source.path.every((part, index) => appearance.path[index] === part)) {
          const path = [...destination, ...appearance.path.slice(source.path.length - 1)];
          const next = [...current.values()].find(
            (item) => item.path.length === path.length && item.path.every((part, index) => part === path[index]),
          );
          keyMap.set(key, keyForPath(next?.editingPath ?? path));
        }
      }
    }
    const parent = [...current.values()].find(
      (item) =>
        item.path.length === destination.length && item.path.every((part, index) => part === destination[index]),
    );
    return { keyMap, revealKeys: destination.length > 0 ? [keyForPath(parent?.editingPath ?? destination)] : [] };
  };
}

function currentAppearance(current: ReadonlyMap<string, WorkspaceAppearance>, original: WorkspaceAppearance) {
  const prefix = (path: readonly string[]) => {
    let length = 0;
    while (length < path.length && path[length] === original.path[length]) {
      length += 1;
    }
    return length;
  };
  return [...current.values()]
    .filter((item) => item.occurrenceId === original.occurrenceId)
    .sort((left, right) => prefix(right.path) - prefix(left.path) || left.path.length - right.path.length)[0];
}

function movementActions(
  graph: WorkspaceSnapshot,
  sources: readonly string[],
  parentNodeId: string,
  move: OutlineMoveDestination,
): readonly EditAction[] {
  const field = Object.values(graph.materializedFields)
    .flat()
    .find((item) => item.fieldNodeId === parentNodeId);
  const siblings = (field?.valueOccurrenceIds ?? graph.childOccurrences[parentNodeId] ?? []).filter(
    (key) => !sources.includes(key),
  );
  const anchor = { ...END_SEQUENCE_ANCHOR, before: siblings[move.index] ?? null };
  return sources.map((occurrenceId) => ({ kind: "occurrence-move", occurrenceId, parentNodeId, anchor }));
}
