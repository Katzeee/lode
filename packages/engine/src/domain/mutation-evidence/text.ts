import { canonicalJson, type JsonValue, type Mutation, type PreviousValue, type TextMutation } from "../fact/index.js";
import { isPresentNodeOutsideTrash, textAtoms, type ScopedProjection } from "../reconcile/index.js";
import type { MutationEvidenceContext, MutationEvidenceFamily } from "./policy.js";
import { assertEvidenceEqual } from "./evidence-validation.js";

type TextSpliceMutation = Extract<Mutation, { kind: "text-splice" }>;
type TextMarkMutation = Extract<Mutation, { kind: "text-mark" }>;

const TEXT_MUTATION_KINDS = ["text-splice", "text-mark"] as const satisfies readonly TextMutation["kind"][];

export const textMutationEvidence = {
  key: "text",
  mutationKinds: TEXT_MUTATION_KINDS,
  complete: completeTextMutationEvidence,
  validate(mutation, context) {
    const { previous, available } = context.projections();
    if (mutation.kind === "text-splice") {
      const expected = completeTextSpliceEvidence(mutation, available);
      assertEvidenceEqual(expected.deletedAtoms, mutation.deletedAtoms, "Text deletion evidence");
    }
    if (mutation.kind === "text-mark") {
      const expected = completeTextMarkEvidence(mutation, previous, available);
      assertEvidenceEqual(expected.previous, mutation.previous, "Text mark previous evidence");
    }
  },
} satisfies MutationEvidenceFamily<(typeof TEXT_MUTATION_KINDS)[number]>;

function completeTextMutationEvidence(mutation: TextMutation, context: MutationEvidenceContext): TextMutation {
  const { previous, available } = context.projections();
  switch (mutation.kind) {
    case "text-splice":
      return completeTextSpliceEvidence(mutation, available);
    case "text-mark":
      return completeTextMarkEvidence(mutation, previous, available);
  }
}

export function completeTextSpliceEvidence(
  mutation: TextSpliceMutation,
  available: ScopedProjection,
): TextSpliceMutation {
  if (!isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, mutation.nodeId)) {
    throw new Error("Text target Node is absent from the observed projection");
  }
  const node = available.nodes[mutation.nodeId];
  if (!node) {
    throw new Error("Text target Node is absent from the observed projection");
  }
  const atoms = textAtoms(node);
  assertTextAnchor(
    mutation,
    node.content.map((item) => item.id),
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

function completeTextMarkEvidence(
  mutation: TextMarkMutation,
  previous: ScopedProjection,
  available: ScopedProjection,
): TextMarkMutation {
  if (!isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, mutation.nodeId)) {
    throw new Error("Text mark target Node is absent from the observed projection");
  }
  const availableNode = available.nodes[mutation.nodeId];
  const availableAtoms = textAtoms(availableNode);
  if (!availableNode || mutation.atomIds.some((id) => !availableAtoms.some((atom) => atom.id === id))) {
    throw new Error("Text mark targets an Atom outside the observed projection");
  }
  const previousAtoms = textAtoms(previous.nodes[mutation.nodeId]);
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
