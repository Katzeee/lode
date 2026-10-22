import { restoreContentRuns, canCompensateContent } from "./content-restoration.js";
import { canonicalJson, compareCausalOrder, type FactAction, type JsonValue, type TextAtomId } from "../fact/index.js";
import { textAtoms, type InterpretedProjection } from "../reconcile/index.js";
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
  if (!canCompensateContent(authoredAction.nodeId, projection, counterfactual)) {
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
  const restoration = restoreContentRuns(
    authoredAction.nodeId,
    deletedStillAbsent,
    counterfactual.nodes[authoredAction.nodeId]?.content ?? [],
    content,
    new Set(inserted.map((atom) => atom.id)),
  );
  return (
    restoration ?? {
      kind: "ready",
      actions: [
        {
          kind: "rich-text-splice",
          nodeId: authoredAction.nodeId,
          deleteAtomIds: inserted.map((atom) => atom.id),
          anchor: authoredAction.anchor,
          insert: "",
        },
      ],
    }
  );
}
function compensateTextMark(
  target: FactAction<Extract<CompensationTargetAction, { kind: "rich-text-mark" }>>,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly FactAction[],
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  const authoredAction = target.action;
  if (!canCompensateContent(authoredAction.nodeId, projection, counterfactual)) {
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
  const groups = new Map<string, { value: ReturnType<typeof previousValue>; atomIds: TextAtomId[] }>();
  for (const id of liveIds) {
    const value = previousValue(
      textAtoms(counterfactual.nodes[authoredAction.nodeId]).find((atom) => atom.id === id)?.attributes[
        authoredAction.key
      ],
    );
    const key = canonicalJson(value);
    const group = groups.get(key) ?? { value, atomIds: [] };
    group.atomIds.push(id);
    groups.set(key, group);
  }
  return liveIds.length === 0
    ? noCompensation()
    : {
        kind: "ready",
        actions: [...groups.values()].map(({ value, atomIds }) => ({
          kind: "rich-text-mark",
          nodeId: authoredAction.nodeId,
          atomIds,
          key: authoredAction.key,
          value,
        })),
      };
}

function previousValue(value: JsonValue | undefined) {
  return value === undefined ? ({ kind: "unset" } as const) : ({ kind: "set", value } as const);
}
