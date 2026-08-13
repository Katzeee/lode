import type { Mutation } from "../../domain/fact/index.js";
import type { TextAtom } from "../../domain/reconcile/index.js";
import type { MutableProjection } from "./planning-projection-mutation.js";
import { insertionIndex } from "./planning-projection-sequence.js";
import { applyPlanningValueMutation, withoutValue } from "./planning-projection-values.js";
import { applySchemaPlanningMutation } from "./planning-schema-relations.js";

export function applyPlanningContentMutation(
  projection: MutableProjection,
  mutation: Mutation,
  factId: string,
): void {
  if (applySchemaPlanningMutation(projection, mutation, factId)) {
    return;
  }
  if (mutation.kind === "text-splice") {
    const node = projection.nodes[mutation.nodeId];
    if (!node) {
      return;
    }
    const remaining = node.text.filter((atom) => !mutation.deleteAtomIds.includes(atom.id));
    const index = insertionIndex(remaining, mutation.anchor);
    const inserted = [...mutation.insert].map((value, offset): TextAtom => ({
      id: `${factId}#${offset}`,
      value,
      attributes: mutation.attributes ?? {},
      contributionId: factId,
    }));
    node.text = [...remaining.slice(0, index), ...inserted, ...remaining.slice(index)];
    return;
  }
  if (mutation.kind === "text-mark") {
    const node = projection.nodes[mutation.nodeId];
    if (!node) {
      return;
    }
    node.text = node.text.map((atom) =>
      mutation.atomIds.includes(atom.id)
        ? {
            ...atom,
            attributes:
              mutation.value.kind === "unset"
                ? withoutValue(atom.attributes, mutation.key)
                : { ...atom.attributes, [mutation.key]: mutation.value.value },
          }
        : atom,
    );
    return;
  }
  if (mutation.kind === "value-set" || mutation.kind === "value-unset") {
    applyPlanningValueMutation(projection, mutation);
  }
}
