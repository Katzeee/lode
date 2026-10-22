import { canonicalJson, type GraphAction, type HistoryContentSource } from "../fact/index.js";
import { isActiveNode, type ProjectedNode, type InterpretedProjection } from "../reconcile/index.js";
import type { CompensationStep, ContentRestoration } from "./compensation-types.js";

type Content = ProjectedNode["content"][number];
type Text = Extract<Content, { kind: "text" }>;
type Run = { items: Content[]; start: number; end: number };

export function canCompensateContent(
  nodeId: string,
  current: InterpretedProjection,
  counterfactual: InterpretedProjection,
): boolean {
  return (
    isActiveNode(current.identity.workspaceNodeId, current, nodeId) ||
    isActiveNode(counterfactual.identity.workspaceNodeId, counterfactual, nodeId)
  );
}

/** Restore an invocation's source sequence independently of its Fact/action grouping. */
export function composeContentRestorations(
  actions: readonly GraphAction[],
  restorations: readonly ContentRestoration[],
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  const restoredActions = new Set(restorations.map((item) => item.action));
  const nodeIds = new Set(
    restorations.flatMap(({ action }) =>
      action.kind === "rich-text-splice"
        ? [action.nodeId]
        : action.kind === "inline-reference-create"
          ? [action.hostNodeId]
          : [],
    ),
  );
  const retained = actions.filter(
    (action) => !restoredActions.has(action) && (action.kind !== "rich-text-splice" || !nodeIds.has(action.nodeId)),
  );
  const origins: ContentRestoration[] = [];
  for (const nodeId of nodeIds) {
    const nodeRestorations = restorations.filter(
      ({ action }) =>
        (action.kind === "rich-text-splice" && action.nodeId === nodeId) ||
        (action.kind === "inline-reference-create" && action.hostNodeId === nodeId),
    );
    const sourceIds = new Set(nodeRestorations.flatMap(({ sources }) => sources.map((source) => source.id)));
    const deletedIds = new Set(
      actions.flatMap<string>((action) =>
        action.kind === "rich-text-splice" && action.nodeId === nodeId
          ? action.deleteAtomIds
          : action.kind === "inline-reference-remove"
            ? [action.inlineReferenceId]
            : [],
      ),
    );
    const previous = counterfactual.nodes[nodeId]?.content ?? [];
    const current = projection.nodes[nodeId]?.content ?? [];
    const restoredItems = previous.filter((item) => sourceIds.has(item.id));
    if (restoredItems.length !== sourceIds.size) {
      return { kind: "stale", reason: "History restoration source sequence is no longer available" };
    }
    const restored = restoreContentRuns(nodeId, restoredItems, previous, current, deletedIds);
    if (restored?.kind === "stale") {
      return restored;
    }
    if (restored?.kind === "ready") {
      retained.push(...restored.actions);
      origins.push(...(restored.restorations ?? []));
    }
  }
  return { kind: "ready", actions: retained, restorations: origins };
}

export function restoreContentRuns(
  nodeId: string,
  restored: readonly Content[],
  previous: ProjectedNode["content"],
  current: ProjectedNode["content"],
  removedIds: ReadonlySet<string>,
): CompensationStep | null {
  if (restored.length === 0) {
    return null;
  }
  const restoredIds = new Set(restored.map((item) => item.id));
  const runs: Run[] = [];
  previous.forEach((item, index) => {
    if (!restoredIds.has(item.id)) {
      return;
    }
    const last = runs.at(-1);
    if (last?.end === index) {
      last.items.push(item);
      last.end = index + 1;
    } else {
      runs.push({ items: [item], start: index, end: index + 1 });
    }
  });
  const liveIds = new Set(current.filter((item) => !removedIds.has(item.id)).map((item) => item.id));
  const actions: GraphAction[] = [];
  const restorations: ContentRestoration[] = [];
  const deletedText = current.filter((item): item is Text => item.kind === "text" && removedIds.has(item.id));
  if (deletedText.length > 0) {
    actions.push({
      kind: "rich-text-splice",
      nodeId,
      deleteAtomIds: deletedText.map((item) => item.id),
      anchor: { before: null, after: null, affinity: "after", fallback: "end" },
      insert: "",
    });
  }
  const anchored = new Map<
    string,
    { anchor: Extract<GraphAction, { kind: "rich-text-splice" }>["anchor"]; items: Content[] }
  >();
  for (const run of runs) {
    const before = previous.slice(run.end).find((item) => liveIds.has(item.id))?.id ?? null;
    const after =
      previous
        .slice(0, run.start)
        .reverse()
        .find((item) => liveIds.has(item.id))?.id ?? null;
    const anchor = {
      before,
      after,
      affinity: "before" as const,
      fallback: run.start === 0 ? ("start" as const) : ("end" as const),
    };
    const key = canonicalJson(anchor);
    const existing = anchored.get(key);
    if (existing) {
      existing.items.push(...run.items);
    } else {
      anchored.set(key, { anchor, items: [...run.items] });
    }
  }
  for (const { anchor, items } of anchored.values()) {
    const groups = restorationGroups(nodeId, items, anchor);
    if (anchor.before === null && (anchor.after !== null || anchor.fallback === "start")) {
      groups.reverse();
    }
    for (const group of groups) {
      actions.push(group.action);
      restorations.push(group);
    }
  }
  return { kind: "ready", actions, restorations };
}

function restorationGroups(
  nodeId: string,
  items: readonly Content[],
  anchor: Extract<GraphAction, { kind: "rich-text-splice" }>["anchor"],
) {
  const groups: { action: GraphAction; sources: HistoryContentSource[] }[] = [];
  for (const item of items) {
    const source = { id: item.id, factActionId: item.factActionId };
    const last = groups.at(-1);
    if (
      item.kind === "text" &&
      last?.action.kind === "rich-text-splice" &&
      canonicalJson(last.action.attributes) === canonicalJson(item.attributes)
    ) {
      last.action = { ...last.action, insert: last.action.insert + item.value };
      last.sources.push(source);
    } else {
      groups.push({
        action:
          item.kind === "text"
            ? {
                kind: "rich-text-splice",
                nodeId,
                deleteAtomIds: [],
                anchor,
                insert: item.value,
                attributes: item.attributes,
              }
            : {
                kind: "inline-reference-create",
                inlineReferenceId: item.id,
                hostNodeId: nodeId,
                targetNodeId: item.targetNodeId,
                anchor,
              },
        sources: [source],
      });
    }
  }
  return groups;
}
