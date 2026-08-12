import type { Mutation } from "../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";

type ProjectionView = ProjectionGeneration["review"];

export function assertNoBatchCreatedAtomReference(
  mutation: Mutation,
  batchCreatedAtomIds: ReadonlySet<string>,
): void {
  const references =
    mutation.kind === "text-splice"
      ? [...mutation.deleteAtomIds, mutation.anchor.after, mutation.anchor.before]
      : mutation.kind === "text-mark"
        ? mutation.atomIds
        : [];
  if (references.some((reference) => reference !== null && batchCreatedAtomIds.has(reference))) {
    throw new Error("Text mutations may only address Atoms observed before the command batch");
  }
}

export function prepareTextSplice(
  mutation: Extract<Mutation, { kind: "text-splice" }>,
  available: ProjectionView,
): Mutation {
  const atoms = available.nodes[mutation.nodeId]?.text;
  if (!atoms) {
    throw new Error(`Text target Node does not exist: ${mutation.nodeId}`);
  }
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const deletedAtoms = mutation.deleteAtomIds.map((id) => {
    const atom = byId.get(id);
    if (!atom) {
      throw new Error(`Text Atom is not present in the observed generation: ${id}`);
    }
    return { id, value: atom.value, attributes: atom.attributes };
  });
  return { ...mutation, deletedAtoms };
}

export function prepareTextMark(
  mutation: Extract<Mutation, { kind: "text-mark" }>,
  previous: ProjectionView,
  available: ProjectionView,
): Mutation {
  const availableAtoms = available.nodes[mutation.nodeId]?.text;
  if (
    !availableAtoms ||
    mutation.atomIds.some((id) => !availableAtoms.some((atom) => atom.id === id))
  ) {
    throw new Error("Text mark targets an Atom outside the observed generation");
  }
  const atoms = previous.nodes[mutation.nodeId]?.text ?? [];
  const values = mutation.atomIds.map(
    (id) => atoms.find((atom) => atom.id === id)?.attributes[mutation.key],
  );
  if (values.some((value) => value !== values[0])) {
    throw new Error("One text-mark Mutation requires one previous attribute value");
  }
  const value = values[0];
  return {
    ...mutation,
    previous: value === undefined ? { kind: "unset" } : { kind: "set", value },
  };
}
