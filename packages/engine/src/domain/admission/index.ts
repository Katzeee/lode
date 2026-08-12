import {
  admitAuthorityRecordShapes,
  canonicalJson,
  type Admission,
  type Fact,
  type FactSnapshot,
  type JsonValue,
  type Mutation,
  type PreviousValue,
  type SequenceAnchor,
  type WorkspaceId,
} from "../fact/index.js";
import {
  CURRENT_PROJECTION_VERSIONS,
  rebuildGeneration,
  valueOwnerAddress,
  type Projection,
} from "../reconcile/index.js";

export function admitAuthorityRecords(
  workspaceId: WorkspaceId,
  records: readonly unknown[],
): Admission {
  return admitAuthorityRecordShapes(workspaceId, records, validateSemanticEvidence);
}

function validateSemanticEvidence(fact: Fact, observed: FactSnapshot): void {
  if (fact.body.kind !== "contribution") {
    return;
  }
  if (fact.body.mutation.kind === "node-create") {
    return;
  }
  if (fact.body.mutation.kind === "node-restore") {
    assertDeletion(
      observed,
      fact.body.mutation.deletionFactId,
      "node-delete",
      fact.body.mutation.nodeId,
    );
    return;
  }
  const generation = rebuildGeneration(
    fact.workspaceId,
    observed,
    CURRENT_PROJECTION_VERSIONS,
  ).generation;
  const previous = fact.body.intent === "direct" ? generation.origin : generation.review;
  const available = generation.review;
  validateMutationEvidence(fact.body.mutation, previous, available, observed);
}

function validateMutationEvidence(
  mutation: Mutation,
  previous: Projection,
  available: Projection,
  observed: FactSnapshot,
): void {
  switch (mutation.kind) {
    case "text-splice": {
      const atoms = available.nodes[mutation.nodeId]?.text;
      if (!atoms) {
        throw new Error("Text target Node is absent from the observed projection");
      }
      const byId = new Map(atoms.map((atom) => [atom.id, atom]));
      const expected = mutation.deleteAtomIds.map((id) => {
        const atom = byId.get(id);
        if (!atom) {
          throw new Error(`Text Atom is absent from the observed projection: ${id}`);
        }
        return { id, value: atom.value, attributes: atom.attributes };
      });
      assertSame(expected, mutation.deletedAtoms, "Text deletion evidence");
      assertTextAnchor(
        mutation.anchor,
        atoms.map((atom) => atom.id),
      );
      return;
    }
    case "text-mark": {
      const availableAtoms = available.nodes[mutation.nodeId]?.text ?? [];
      if (mutation.atomIds.some((id) => !availableAtoms.some((atom) => atom.id === id))) {
        throw new Error("Text mark targets an Atom outside the observed projection");
      }
      const previousAtoms = previous.nodes[mutation.nodeId]?.text ?? [];
      const states = mutation.atomIds.map((id) =>
        previousValue(previousAtoms.find((atom) => atom.id === id)?.attributes[mutation.key]),
      );
      if (states.some((state) => canonicalJson(state) !== canonicalJson(states[0]))) {
        throw new Error("Text mark targets have different observed previous values");
      }
      assertSame(states[0], mutation.previous, "Text mark previous evidence");
      return;
    }
    case "value-set":
    case "value-unset":
      assertValueOwnerAvailable(mutation, available);
      assertSame(
        previousValue(readValue(previous, mutation)),
        mutation.previous,
        "Value previous evidence",
      );
      return;
    case "occurrence-move":
    case "occurrence-delete": {
      const occurrence = available.occurrences[mutation.occurrenceId];
      if (!occurrence) {
        throw new Error("Occurrence target is absent from the observed projection");
      }
      const prior = previous.occurrences[mutation.occurrenceId] ?? occurrence;
      assertSame(
        prior.parentOccurrenceId,
        mutation.previousParentOccurrenceId,
        "Occurrence previous parent evidence",
      );
      assertSame(
        anchorFor(
          previous.occurrences[mutation.occurrenceId] ? previous : available,
          mutation.occurrenceId,
        ),
        mutation.previousAnchor,
        "Occurrence previous anchor evidence",
      );
      return;
    }
    case "canonical-occurrence-set":
      if (available.occurrences[mutation.occurrenceId]?.nodeId !== mutation.nodeId) {
        throw new Error("Canonical target is absent from the observed projection");
      }
      assertSame(
        previous.canonicalOccurrences[mutation.nodeId] ?? null,
        mutation.previousOccurrenceId,
        "Canonical previous evidence",
      );
      return;
    case "node-delete":
      if (!available.nodes[mutation.nodeId]) {
        throw new Error("Node delete target is absent from the observed projection");
      }
      return;
    case "occurrence-create":
      if (!available.nodes[mutation.nodeId]) {
        throw new Error("Occurrence Node is absent from the observed projection");
      }
      assertParent(available, mutation.parentOccurrenceId);
      return;
    case "occurrence-restore":
      assertDeletion(observed, mutation.deletionFactId, "occurrence-delete", mutation.occurrenceId);
      assertParent(available, mutation.parentOccurrenceId);
      break;
    case "node-create":
    case "node-restore":
      break;
  }
}

function readValue(
  projection: Projection,
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
) {
  if (mutation.owner.kind === "node") {
    const owner = projection.nodes[mutation.owner.id];
    return mutation.namespace === "metadata"
      ? owner?.metadata[mutation.key]
      : owner?.properties[mutation.key];
  }
  if (mutation.owner.kind === "occurrence") {
    const owner = projection.occurrences[mutation.owner.id];
    return mutation.namespace === "metadata"
      ? owner?.metadata[mutation.key]
      : owner?.properties[mutation.key];
  }
  return projection.addressedValues[valueOwnerAddress(mutation.owner, mutation.namespace)]?.[
    mutation.key
  ];
}

function assertValueOwnerAvailable(
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
  projection: Projection,
): void {
  if (mutation.owner.kind === "node" && !projection.nodes[mutation.owner.id]) {
    throw new Error("Value Node owner is absent from the observed projection");
  }
  if (mutation.owner.kind === "occurrence" && !projection.occurrences[mutation.owner.id]) {
    throw new Error("Value Occurrence owner is absent from the observed projection");
  }
}

function assertParent(projection: Projection, parentId: string | null): void {
  if (parentId !== null && !projection.occurrences[parentId]) {
    throw new Error("Parent Occurrence is absent from the observed projection");
  }
}

function assertDeletion(
  snapshot: FactSnapshot,
  deletionFactId: string,
  kind: "node-delete" | "occurrence-delete",
  identity: string,
): void {
  const deletion = snapshot.facts.find((fact) => fact.id === deletionFactId);
  const mutation = deletion?.body.kind === "contribution" ? deletion.body.mutation : null;
  const matches =
    kind === "node-delete"
      ? mutation?.kind === kind && mutation.nodeId === identity
      : mutation?.kind === kind && mutation.occurrenceId === identity;
  if (!matches) {
    throw new Error(`Restore does not reference an observed ${kind} Fact`);
  }
}

function assertTextAnchor(anchor: SequenceAnchor, atomIds: readonly string[]): void {
  for (const endpoint of [anchor.after, anchor.before]) {
    if (endpoint !== null && !atomIds.includes(endpoint)) {
      throw new Error("Text anchor endpoint is absent from the observed projection");
    }
  }
}

function anchorFor(projection: Projection, occurrenceId: string): SequenceAnchor {
  const occurrence = projection.occurrences[occurrenceId];
  const siblings = projection.children[occurrence?.parentOccurrenceId ?? "$root"] ?? [];
  const index = siblings.indexOf(occurrenceId);
  return {
    after: index > 0 ? (siblings[index - 1] ?? null) : null,
    before: index >= 0 ? (siblings[index + 1] ?? null) : null,
    affinity: "after",
    fallback: index <= 0 ? "start" : "end",
  };
}

function previousValue(value: JsonValue | undefined): PreviousValue {
  return value === undefined ? { kind: "unset" } : { kind: "set", value };
}

function assertSame(expected: unknown, actual: unknown, label: string): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`${label} does not match the observed projection`);
  }
}
