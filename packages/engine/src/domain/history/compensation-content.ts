import {
  canonicalJson,
  compareFacts,
  isTextMutation,
  isValueMutation,
  type ContributionFact,
  type JsonValue,
  type Mutation,
  type TextAtomId,
} from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";
import { compensateValueMutation } from "./compensation-value.js";

export function compensateContentMutation(
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep | null {
  const mutation = target.body.mutation;
  if (isValueMutation(mutation)) {
    return compensateValueMutation(target, activeFacts, projection);
  }
  if (!isTextMutation(mutation)) {
    return null;
  }
  switch (mutation.kind) {
    case "text-splice":
      return compensateTextSplice(target, activeFacts, projection);
    case "text-mark":
      return compensateTextMark(target, targetIds, activeFacts, projection);
  }
}

function compensateTextSplice(
  target: ContributionFact,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (mutation.kind !== "text-splice") {
    return noCompensation();
  }
  const atoms = projection.nodes[mutation.nodeId]?.text ?? [];
  if (!projection.nodes[mutation.nodeId]) {
    return noCompensation();
  }
  const inserted = atoms.filter((atom) => atom.contributionId === target.id);
  const deleted = mutation.deletedAtoms ?? [];
  let deletedStillAbsent = deleted.filter(
    (atom) =>
      !atoms.some((current) => current.id === atom.id) &&
      !activeFacts.some(
        (fact) =>
          fact.id !== target.id &&
          fact.body.mutation.kind === "text-splice" &&
          fact.body.mutation.nodeId === mutation.nodeId &&
          fact.body.mutation.deleteAtomIds.includes(atom.id),
      ),
  );
  const insertedIds = [...mutation.insert].map((_, index): TextAtomId => `${target.id}#${index}`);
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
      const candidate = fact.body.mutation;
      return (
        compareFacts(target, fact) < 0 &&
        candidate.kind === "text-splice" &&
        candidate.nodeId === mutation.nodeId &&
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
    mutation.anchor,
    inserted.map((atom) => atom.id),
    atoms,
  );
  const groups = restoreGroups(deletedStillAbsent);
  const orderedGroups = anchorPrepends(anchor, atoms) ? [...groups].reverse() : groups;
  if (orderedGroups.length === 0) {
    orderedGroups.push({ text: "", attributes: {} });
  }
  return {
    kind: "ready",
    mutations: orderedGroups.map((group, index) => ({
      kind: "text-splice",
      nodeId: mutation.nodeId,
      deleteAtomIds: index === 0 ? inserted.map((atom) => atom.id) : [],
      deletedAtoms:
        index === 0
          ? inserted.map(({ id, value, attributes: atomAttributes }) => ({
              id,
              value,
              attributes: atomAttributes,
            }))
          : [],
      anchor,
      insert: group.text,
      attributes: group.attributes,
    })),
  };
}

function currentTextAnchor(
  original: Extract<Mutation, { kind: "text-splice" }>["anchor"],
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
  anchor: Extract<Mutation, { kind: "text-splice" }>["anchor"],
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
  target: ContributionFact,
  targetIds: ReadonlySet<string>,
  activeFacts: readonly ContributionFact[],
  projection: ScopedProjection,
): CompensationStep {
  const mutation = target.body.mutation;
  if (mutation.kind !== "text-mark") {
    return noCompensation();
  }
  const independentlyMarked = new Set(
    activeFacts.flatMap((fact) => {
      const candidate = fact.body.mutation;
      return !targetIds.has(fact.id) &&
        compareFacts(target, fact) < 0 &&
        candidate.kind === "text-mark" &&
        candidate.nodeId === mutation.nodeId &&
        candidate.key === mutation.key
        ? candidate.atomIds.filter((id) => mutation.atomIds.includes(id))
        : [];
    }),
  );
  if (mutation.previous === undefined) {
    return { kind: "stale", reason: "Text mark lacks its previous value" };
  }
  const liveIds = mutation.atomIds.filter(
    (id) => !independentlyMarked.has(id) && projection.nodes[mutation.nodeId]?.text.some((atom) => atom.id === id),
  );
  return liveIds.length === 0
    ? noCompensation()
    : {
        kind: "ready",
        mutations: [
          {
            kind: "text-mark",
            nodeId: mutation.nodeId,
            atomIds: liveIds,
            key: mutation.key,
            value: mutation.previous,
            previous: mutation.value,
          },
        ],
      };
}
