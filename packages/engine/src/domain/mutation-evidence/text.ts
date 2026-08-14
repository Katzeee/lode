import { canonicalJson, type JsonValue, type Mutation, type PreviousValue } from "../fact/index.js";
import type { ScopedProjection } from "../reconcile/index.js";

type TextSpliceMutation = Extract<Mutation, { kind: "text-splice" }>;
type TextMarkMutation = Extract<Mutation, { kind: "text-mark" }>;

export function completeTextSpliceEvidence(
  mutation: TextSpliceMutation,
  available: ScopedProjection,
): TextSpliceMutation {
  const atoms = available.nodes[mutation.nodeId]?.text;
  if (!atoms) {
    throw new Error("Text target Node is absent from the observed projection");
  }
  assertTextAnchor(
    mutation,
    atoms.map((atom) => atom.id),
  );
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const deletedAtoms = mutation.deleteAtomIds.map((id) => {
    const atom = byId.get(id);
    if (!atom) {
      throw new Error(`Text Atom is absent from the observed projection: ${id}`);
    }
    return { id, value: atom.value, attributes: atom.attributes };
  });
  return { ...mutation, deletedAtoms };
}

export function completeTextMarkEvidence(
  mutation: TextMarkMutation,
  previous: ScopedProjection,
  available: ScopedProjection,
): TextMarkMutation {
  const availableAtoms = available.nodes[mutation.nodeId]?.text;
  if (
    !availableAtoms ||
    mutation.atomIds.some((id) => !availableAtoms.some((atom) => atom.id === id))
  ) {
    throw new Error("Text mark targets an Atom outside the observed projection");
  }
  const previousAtoms = previous.nodes[mutation.nodeId]?.text ?? [];
  const states = mutation.atomIds.map((id) =>
    previousValue(previousAtoms.find((atom) => atom.id === id)?.attributes[mutation.key]),
  );
  if (states.some((state) => canonicalJson(state) !== canonicalJson(states[0]))) {
    throw new Error("Text mark targets have different observed previous values");
  }
  return { ...mutation, previous: states[0] };
}

function assertTextAnchor(mutation: TextSpliceMutation, atomIds: readonly string[]): void {
  for (const endpoint of [mutation.anchor.after, mutation.anchor.before]) {
    if (endpoint !== null && !atomIds.includes(endpoint)) {
      throw new Error("Text anchor endpoint is absent from the observed projection");
    }
  }
}

function previousValue(value: JsonValue | undefined): PreviousValue {
  return value === undefined ? { kind: "unset" } : { kind: "set", value };
}
