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
  assertMaterializedField,
  type Projection,
} from "../reconcile/index.js";
import { validateSchemaEvidence } from "./schema-evidence.js";
import { validateTemplateDetachmentEvidence } from "./template-node-evidence.js";
import { validateFieldContentDeletionEvidence } from "./field-content-evidence.js";
import { assertDeletion } from "./deletion-evidence.js";
import {
  assertOccurrenceParent,
  validateOccurrenceCreate,
  validateOccurrenceEvidence,
} from "./occurrence-evidence.js";
import { validateDomainTransaction } from "./transaction-validation.js";

export function admitAuthorityRecords(
  workspaceId: WorkspaceId,
  records: readonly unknown[],
): Admission {
  return admitAuthorityRecordShapes(workspaceId, records, {
    validateFact: validateSemanticEvidence,
    validateTransaction: validateDomainTransaction,
  });
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
    case "text-splice":
      validateTextSpliceEvidence(mutation, available);
      return;
    case "text-mark":
      validateTextMarkEvidence(mutation, previous, available);
      return;
    case "value-set":
    case "value-unset":
      assertValueTargetAvailable(mutation, available);
      assertSame(
        previousValue(readValue(previous, mutation)),
        mutation.previous,
        "Value previous evidence",
      );
      return;
    case "occurrence-move":
    case "occurrence-delete":
      validateOccurrenceEvidence(mutation, previous, available);
      return;
    case "node-owner-set":
      if (
        !available.nodes[mutation.ownerNodeId] ||
        !Object.values(available.occurrences).some(
          (occurrence) =>
            occurrence.nodeId === mutation.nodeId &&
            occurrence.parentNodeId === mutation.ownerNodeId,
        )
      ) {
        throw new Error("Owner target is absent from the observed projection");
      }
      assertOwnerAcyclic(mutation.nodeId, mutation.ownerNodeId, previous);
      assertSame(
        previous.nodeOwners[mutation.nodeId],
        mutation.previousOwnerNodeId ?? null,
        "Owner previous evidence",
      );
      return;
    case "schema-apply":
    case "schema-remove":
    case "schema-field-add":
    case "schema-field-remove":
    case "schema-field-configure":
    case "schema-extension-add":
    case "schema-extension-remove":
    case "schema-template-node-add":
    case "schema-template-node-remove":
      validateSchemaEvidence(mutation, previous, available);
      return;
    case "template-node-detach":
      validateTemplateDetachmentEvidence(mutation, available);
      return;
    case "field-materialize":
      assertMaterializedField(mutation, available);
      return;
    case "field-initialize":
      validateFieldInitializationEvidence(mutation, available);
      return;
    case "field-value-delete":
    case "materialized-field-delete":
      validateFieldContentDeletionEvidence(mutation, previous, available);
      return;
    case "node-delete":
      if (!available.nodes[mutation.nodeId]) {
        throw new Error("Node delete target is absent from the observed projection");
      }
      return;
    case "occurrence-create":
      validateOccurrenceCreate(mutation, available);
      return;
    case "occurrence-restore":
      assertDeletion(observed, mutation.deletionFactId, "occurrence-delete", mutation.occurrenceId);
      assertOccurrenceParent(available, mutation.parentNodeId);
      break;
    case "node-create":
    case "node-restore":
      break;
  }
}

function validateFieldInitializationEvidence(
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
  available: Projection,
): void {
  for (const nodeId of [mutation.ownerNodeId, mutation.schemaId, mutation.fieldDefinitionId]) {
    if (!available.nodes[nodeId]) {
      throw new Error(`Field initialization dependency is absent: ${nodeId}`);
    }
  }
  const field = available.effectiveFields[mutation.ownerNodeId]?.find(
    (candidate) => candidate.fieldDefinitionId === mutation.fieldDefinitionId,
  );
  if (!field) {
    throw new Error("Field initialization has no effective Schema source");
  }
  if (field.materializedFieldNodeId !== null) {
    throw new Error("Field is already materialized");
  }
  const expectedIds = field.initializationCandidates.map((candidate) => candidate.initializationId);
  if (
    canonicalJson([...expectedIds].sort()) !==
    canonicalJson([...(mutation.observedInitializationFactIds ?? [])].sort())
  ) {
    throw new Error("Field initialization evidence does not match current candidates");
  }
}

function validateTextSpliceEvidence(
  mutation: Extract<Mutation, { kind: "text-splice" }>,
  available: Projection,
): void {
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
}

function validateTextMarkEvidence(
  mutation: Extract<Mutation, { kind: "text-mark" }>,
  previous: Projection,
  available: Projection,
): void {
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
}

function readValue(
  projection: Projection,
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
) {
  if (mutation.target.kind === "node") {
    const target = projection.nodes[mutation.target.id];
    return mutation.namespace === "metadata"
      ? target?.metadata[mutation.key]
      : target?.properties[mutation.key];
  }
  const target = projection.occurrences[mutation.target.id];
  return mutation.namespace === "metadata"
    ? target?.metadata[mutation.key]
    : target?.properties[mutation.key];
}

function assertValueTargetAvailable(
  mutation: Extract<Mutation, { kind: "value-set" | "value-unset" }>,
  projection: Projection,
): void {
  if (mutation.target.kind === "node" && !projection.nodes[mutation.target.id]) {
    throw new Error("Value target Node is absent from the observed projection");
  }
  if (mutation.target.kind === "occurrence" && !projection.occurrences[mutation.target.id]) {
    throw new Error("Value target Occurrence is absent from the observed projection");
  }
}

function assertOwnerAcyclic(nodeId: string, ownerNodeId: string, projection: Projection): void {
  let cursor: string | null | undefined = ownerNodeId;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined) {
    if (cursor === nodeId || seen.has(cursor)) {
      throw new Error("Node ownership would form a cycle");
    }
    seen.add(cursor);
    cursor = projection.nodeOwners[cursor];
  }
}

function assertTextAnchor(anchor: SequenceAnchor, atomIds: readonly string[]): void {
  for (const endpoint of [anchor.after, anchor.before]) {
    if (endpoint !== null && !atomIds.includes(endpoint)) {
      throw new Error("Text anchor endpoint is absent from the observed projection");
    }
  }
}

function previousValue(value: JsonValue | undefined): PreviousValue {
  return value === undefined ? { kind: "unset" } : { kind: "set", value };
}

function assertSame(expected: unknown, actual: unknown, label: string): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`${label} does not match the observed projection`);
  }
}
