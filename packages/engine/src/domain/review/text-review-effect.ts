import { canonicalJson, type FactAction, type JsonValue, type PreviousValue } from "../fact/index.js";
import { textAtoms, type ScopedProjectionGeneration } from "../reconcile/index.js";
import type { TextDecisionEffect } from "./types.js";

export function textEffect(
  nodeId: string,
  targets: readonly FactAction[],
  generation: ScopedProjectionGeneration,
): TextDecisionEffect {
  const origin = textAtoms(generation.origin.nodes[nodeId]);
  const review = textAtoms(generation.review.nodes[nodeId]);
  const originById = new Map(origin.map((atom) => [atom.id, atom]));
  const reviewById = new Map(review.map((atom) => [atom.id, atom]));
  const targetIds = new Set(targets.map((target) => target.id));
  const targetDeletedIds = new Set(
    targets.flatMap((target) => (target.action.kind === "rich-text-splice" ? target.action.deleteAtomIds : [])),
  );
  const targetMarks = new Set(
    targets.flatMap((target) => {
      const action = target.action;
      return action.kind === "rich-text-mark" ? action.atomIds.map((atomId) => `${atomId}/${action.key}`) : [];
    }),
  );
  const addedAtomIds = review
    .filter((atom) => !originById.has(atom.id) && targetIds.has(atom.factActionId))
    .map((atom) => atom.id);
  const deletedAtomIds = origin
    .filter((atom) => !reviewById.has(atom.id) && targetDeletedIds.has(atom.id))
    .map((atom) => atom.id);
  const markChanges = [...originById]
    .filter(([id]) => reviewById.has(id))
    .flatMap(([id, originAtom]) => {
      const reviewAtom = reviewById.get(id)!;
      const keys = new Set([...Object.keys(originAtom.attributes), ...Object.keys(reviewAtom.attributes)]);
      return [...keys]
        .filter(
          (key) =>
            targetMarks.has(`${id}/${key}`) &&
            canonicalJson(attributeState(originAtom.attributes, key)) !==
              canonicalJson(attributeState(reviewAtom.attributes, key)),
        )
        .map((key) => ({
          atomId: id,
          key,
          origin: attributeState(originAtom.attributes, key),
          review: attributeState(reviewAtom.attributes, key),
        }));
    });
  return { kind: "text", nodeId, addedAtomIds, deletedAtomIds, markChanges };
}

export function hasTextEffect(effect: TextDecisionEffect): boolean {
  return effect.addedAtomIds.length + effect.deletedAtomIds.length + effect.markChanges.length > 0;
}

export function isTextAction(
  action: FactAction["action"],
): action is Extract<FactAction["action"], { kind: "rich-text-splice" | "rich-text-mark" }> {
  return action.kind === "rich-text-splice" || action.kind === "rich-text-mark";
}

function attributeState(values: Readonly<Record<string, JsonValue>>, key: string): PreviousValue {
  return Object.hasOwn(values, key) ? { kind: "set", value: values[key] ?? null } : { kind: "unset" };
}
