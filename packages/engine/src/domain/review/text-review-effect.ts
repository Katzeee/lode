import { canonicalJson, type ContributionFact, type JsonValue, type PreviousValue } from "../fact/index.js";
import type { ScopedProjectionGeneration } from "../reconcile/index.js";
import type { TextDecisionEffect } from "./types.js";

export function textEffect(
  nodeId: string,
  targets: readonly ContributionFact[],
  generation: ScopedProjectionGeneration,
): TextDecisionEffect {
  const origin = generation.origin.nodes[nodeId]?.text ?? [];
  const review = generation.review.nodes[nodeId]?.text ?? [];
  const originById = new Map(origin.map((atom) => [atom.id, atom]));
  const reviewById = new Map(review.map((atom) => [atom.id, atom]));
  const targetIds = new Set(targets.map((target) => target.id));
  const targetDeletedIds = new Set(
    targets.flatMap((target) =>
      target.body.mutation.kind === "text-splice" ? target.body.mutation.deleteAtomIds : [],
    ),
  );
  const targetMarks = new Set(
    targets.flatMap((target) => {
      const mutation = target.body.mutation;
      return mutation.kind === "text-mark" ? mutation.atomIds.map((atomId) => `${atomId}/${mutation.key}`) : [];
    }),
  );
  const addedAtomIds = review
    .filter((atom) => !originById.has(atom.id) && targetIds.has(atom.contributionId))
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

export function isTextMutation(
  mutation: ContributionFact["body"]["mutation"],
): mutation is Extract<ContributionFact["body"]["mutation"], { kind: "text-splice" | "text-mark" }> {
  return mutation.kind === "text-splice" || mutation.kind === "text-mark";
}

function attributeState(values: Readonly<Record<string, JsonValue>>, key: string): PreviousValue {
  return Object.hasOwn(values, key) ? { kind: "set", value: values[key] ?? null } : { kind: "unset" };
}
