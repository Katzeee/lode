import {
  canonicalJson,
  compareCausalOrder,
  type FactAction,
  type JsonValue,
  type GraphAction,
  type TextAtomId,
} from "../fact/index.js";
import { isActiveNode, textAtoms, type InterpretedProjection } from "../reconcile/index.js";
import {
  noCompensation,
  type CompensationCatalog,
  type CompensationStep,
  type CompensationTargetAction,
} from "./compensation-types.js";

export const CONTENT_COMPENSATIONS = {
  "rich-text-splice": ({ activeFacts, projection, counterfactual }, target) =>
    compensateTextSplice(target, activeFacts, projection, counterfactual),
  "rich-text-mark": ({ targetIds, activeFacts, projection, counterfactual }, target) =>
    compensateTextMark(target, targetIds, activeFacts, projection, counterfactual),
} satisfies Partial<CompensationCatalog>;

function compensateTextSplice(
  target: FactAction<Extract<CompensationTargetAction, { kind: "rich-text-splice" }>>,
  activeFacts: readonly FactAction[],
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  const authoredAction = target.action;
  const node = projection.nodes[authoredAction.nodeId];
  const atoms = textAtoms(node);
  const content = node?.content ?? [];
  if (!isActiveNode(projection.identity.workspaceNodeId, projection, authoredAction.nodeId)) {
    return noCompensation();
  }
  const inserted = atoms.filter((atom) => atom.factActionId === target.id);
  const deleted = authoredAction.deleteAtomIds.flatMap((id) => {
    const atom = textAtoms(counterfactual.nodes[authoredAction.nodeId]).find((candidate) => candidate.id === id);
    return atom === undefined ? [] : [atom];
  });
  let deletedStillAbsent = deleted.filter(
    (atom) =>
      !atoms.some((current) => current.id === atom.id) &&
      !activeFacts.some(
        (fact) =>
          fact.id !== target.id &&
          fact.action.kind === "rich-text-splice" &&
          fact.action.nodeId === authoredAction.nodeId &&
          fact.action.deleteAtomIds.includes(atom.id),
      ),
  );
  const insertedIds = [...authoredAction.insert].map((_, index): TextAtomId => `${target.id}#${index}`);
  if (deleted.length > 0 && deleted.length === insertedIds.length) {
    const liveInsertedIds = new Set(inserted.map((atom) => atom.id));
    deletedStillAbsent = deletedStillAbsent.filter((_atom, index) => {
      const insertedId = insertedIds[index];
      return insertedId !== undefined && liveInsertedIds.has(insertedId);
    });
  }
  const laterReplacementSupersedesTarget =
    insertedIds.length > 0 &&
    inserted.length === 0 &&
    activeFacts.some((fact) => {
      const candidate = fact.action;
      return (
        compareCausalOrder(target, fact) < 0 &&
        candidate.kind === "rich-text-splice" &&
        candidate.nodeId === authoredAction.nodeId &&
        candidate.insert.length > 0 &&
        insertedIds.every((id) => candidate.deleteAtomIds.includes(id))
      );
    });
  if (laterReplacementSupersedesTarget) {
    deletedStillAbsent = [];
  }
  if (inserted.length === 0 && deletedStillAbsent.length === 0) {
    return noCompensation();
  }
  const anchor = currentTextAnchor(
    authoredAction.anchor,
    inserted.map((atom) => atom.id),
    content,
  );
  const groups = restoreGroups(deletedStillAbsent);
  const orderedGroups = anchorPrepends(anchor, content) ? [...groups].reverse() : groups;
  if (orderedGroups.length === 0) {
    orderedGroups.push({ text: "", attributes: {} });
  }
  return {
    kind: "ready",
    actions: orderedGroups.map((group, index) => ({
      kind: "rich-text-splice",
      nodeId: authoredAction.nodeId,
      deleteAtomIds: index === 0 ? inserted.map((atom) => atom.id) : [],
      anchor,
      insert: group.text,
      attributes: group.attributes,
    })),
  };
}

function currentTextAnchor(
  original: Extract<GraphAction, { kind: "rich-text-splice" }>["anchor"],
  targetIds: readonly string[],
  atoms: readonly Readonly<{ id: string }>[],
) {
  const indices = targetIds.map((id) => atoms.findIndex((atom) => atom.id === id)).filter((index) => index >= 0);
  if (indices.length > 0) {
    const first = Math.min(...indices);
    const last = Math.max(...indices);
    return {
      after: first > 0 ? (atoms[first - 1]?.id ?? null) : null,
      before: last + 1 < atoms.length ? (atoms[last + 1]?.id ?? null) : null,
      affinity: "after" as const,
      fallback: first === 0 ? ("start" as const) : ("end" as const),
    };
  }
  const after = original.after !== null && atoms.some((atom) => atom.id === original.after) ? original.after : null;
  const before = original.before !== null && atoms.some((atom) => atom.id === original.before) ? original.before : null;
  return {
    after,
    before,
    affinity: original.affinity,
    fallback: original.fallback,
  };
}

function restoreGroups(
  atoms: readonly Readonly<{ value: string; attributes: Readonly<Record<string, JsonValue>> }>[],
): Readonly<{ text: string; attributes: Readonly<Record<string, JsonValue>> }>[] {
  const groups: { text: string; attributes: Readonly<Record<string, JsonValue>> }[] = [];
  for (const atom of atoms) {
    const current = groups.at(-1);
    if (current && canonicalJson(current.attributes) === canonicalJson(atom.attributes)) {
      current.text += atom.value;
    } else {
      groups.push({ text: atom.value, attributes: atom.attributes });
    }
  }
  return groups;
}

function anchorPrepends(
  anchor: Extract<GraphAction, { kind: "rich-text-splice" }>["anchor"],
  atoms: readonly Readonly<{ id: string }>[],
): boolean {
  const after = anchor.after !== null && atoms.some((atom) => atom.id === anchor.after);
  const before = anchor.before !== null && atoms.some((atom) => atom.id === anchor.before);
  if (after) {
    return !before || anchor.affinity === "after";
  }
  return !before && anchor.fallback === "start";
}

function compensateTextMark(
  target: FactAction<Extract<CompensationTargetAction, { kind: "rich-text-mark" }>>,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  const authoredAction = target.action;
  if (!isActiveNode(projection.identity.workspaceNodeId, projection, authoredAction.nodeId)) {
    return noCompensation();
  }
  const independentlyMarked = new Set(
    activeFacts.flatMap((fact) => {
      const candidate = fact.action;
      return !targetIds.has(fact.id) &&
        compareCausalOrder(target, fact) < 0 &&
        candidate.kind === "rich-text-mark" &&
        candidate.nodeId === authoredAction.nodeId &&
        candidate.key === authoredAction.key
        ? candidate.atomIds.filter((id) => authoredAction.atomIds.includes(id))
        : [];
    }),
  );
  const liveIds = authoredAction.atomIds.filter(
    (id) =>
      !independentlyMarked.has(id) && textAtoms(projection.nodes[authoredAction.nodeId]).some((atom) => atom.id === id),
  );
  const previousValues = liveIds.map((id) =>
    previousValue(
      textAtoms(counterfactual.nodes[authoredAction.nodeId]).find((atom) => atom.id === id)?.attributes[
        authoredAction.key
      ],
    ),
  );
  const previous = previousValues[0];
  if (previous === undefined) {
    return noCompensation();
  }
  if (previousValues.some((value) => canonicalJson(value) !== canonicalJson(previous))) {
    return { kind: "stale", reason: "Text mark targets do not share one previous value" };
  }
  return liveIds.length === 0
    ? noCompensation()
    : {
        kind: "ready",
        actions: [
          {
            kind: "rich-text-mark",
            nodeId: authoredAction.nodeId,
            atomIds: liveIds,
            key: authoredAction.key,
            value: previous,
          },
        ],
      };
}

function previousValue(value: JsonValue | undefined) {
  return value === undefined ? ({ kind: "unset" } as const) : ({ kind: "set", value } as const);
}
