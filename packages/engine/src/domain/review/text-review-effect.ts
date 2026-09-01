import {
  canonicalJson,
  isTextAction,
  type FactAction,
  type JsonValue,
  type PreviousValue,
  type TextAction,
} from "../fact/index.js";
import { textAtoms, type InterpretedProjectionGeneration } from "../reconcile/index.js";
import type { TextDecisionEffect } from "./types.js";

export function textEffect(
  nodeId: string,
  targets: readonly FactAction<TextAction>[],
  generation: InterpretedProjectionGeneration,
): TextDecisionEffect {
  const origin = textAtoms(generation.origin.nodes[nodeId]);
  const review = textAtoms(generation.review.nodes[nodeId]);
  const originById = new Map(origin.map((atom) => [atom.id, atom]));
  const reviewById = new Map(review.map((atom) => [atom.id, atom]));
  const targetIds = new Set(targets.map((target) => target.id));
  const targetDeletedIds = new Set(targets.flatMap((target) => deletedTextAtomIds(target.action)));
  const targetMarks = new Set(targets.flatMap((target) => markedAttributes(target.action)));
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

export function isTextFactAction(fact: FactAction): fact is FactAction<TextAction> {
  return isTextAction(fact.action);
}

function deletedTextAtomIds(action: TextAction): readonly string[] {
  switch (action.kind) {
    case "rich-text-splice":
      return action.deleteAtomIds;
    case "rich-text-mark":
      return [];
    default:
      return assertNever(action);
  }
}

function markedAttributes(action: TextAction): readonly string[] {
  switch (action.kind) {
    case "rich-text-splice":
      return [];
    case "rich-text-mark":
      return action.atomIds.map((atomId) => `${atomId}/${action.key}`);
    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown Text Action: ${JSON.stringify(value)}`);
}

function attributeState(values: Readonly<Record<string, JsonValue>>, key: string): PreviousValue {
  return Object.hasOwn(values, key) ? { kind: "set", value: values[key] ?? null } : { kind: "unset" };
}
