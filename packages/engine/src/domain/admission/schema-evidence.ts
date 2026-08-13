import { canonicalJson, type Mutation, type SequenceAnchor } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateSchemaEvidence(
  mutation: Extract<Mutation, { kind: `schema-${string}` }>,
  previous: Projection,
  available: Projection,
): void {
  if (mutation.kind === "schema-field-configure") {
    validateFieldConfiguration(mutation, available);
    return;
  }
  if (mutation.kind === "schema-apply" || mutation.kind === "schema-remove") {
    validateApplication(mutation, previous, available);
    return;
  }
  if (mutation.kind === "schema-extension-add" || mutation.kind === "schema-extension-remove") {
    validateExtension(mutation, previous, available);
    return;
  }
  if (
    mutation.kind === "schema-template-node-add" ||
    mutation.kind === "schema-template-node-remove"
  ) {
    validateTemplateNode(mutation, previous, available);
    return;
  }
  validateTemplateField(mutation, previous, available);
}

function validateFieldConfiguration(
  mutation: Extract<Mutation, { kind: "schema-field-configure" }>,
  available: Projection,
): void {
  requireDefinition(available, mutation.schemaId, "Schema", false);
  requireDefinition(available, mutation.fieldDefinitionId, "Field Definition", false);
  requireNode(available, mutation.fieldNodeId, "Template Field");
  const item = available.templateFields[mutation.schemaId]?.find(
    (candidate) => candidate.fieldNodeId === mutation.fieldNodeId,
  );
  if (!item || item.fieldDefinitionId !== mutation.fieldDefinitionId) {
    throw new Error("Schema Field is absent from the observed projection");
  }
  const observedIds = item.configCandidates.flatMap((candidate) => candidate.contributionIds);
  if (
    canonicalJson([...observedIds].sort()) !==
    canonicalJson([...(mutation.observedConfigFactIds ?? [])].sort())
  ) {
    throw new Error("Field config Fact evidence does not match the observed projection");
  }
  if (canonicalJson(item.effectiveConfig) !== canonicalJson(mutation.previousConfig)) {
    throw new Error("Field previous config does not match the observed projection");
  }
}

function validateApplication(
  mutation: Extract<Mutation, { kind: "schema-apply" | "schema-remove" }>,
  previous: Projection,
  available: Projection,
): void {
  requireDefinition(available, mutation.schemaId, "Schema", mutation.kind === "schema-remove");
  requireNode(available, mutation.nodeId, "Schema application target");
  validateRelation(
    available.schemaApplications[mutation.nodeId] ?? [],
    previous.schemaApplications[mutation.nodeId] ?? [],
    mutation.schemaId,
    mutation.kind === "schema-apply" ? mutation.anchor : mutation.previousAnchor,
    mutation.kind === "schema-apply",
    "Schema Application",
  );
}

function validateExtension(
  mutation: Extract<Mutation, { kind: "schema-extension-add" | "schema-extension-remove" }>,
  previous: Projection,
  available: Projection,
): void {
  const removing = mutation.kind === "schema-extension-remove";
  requireDefinition(available, mutation.schemaId, "Schema", removing);
  requireDefinition(available, mutation.baseSchemaId, "Base Schema", removing);
  validateRelation(
    available.schemaExtensions[mutation.schemaId] ?? [],
    previous.schemaExtensions[mutation.schemaId] ?? [],
    mutation.baseSchemaId,
    mutation.kind === "schema-extension-add" ? mutation.anchor : mutation.previousAnchor,
    mutation.kind === "schema-extension-add",
    "Schema Extension",
  );
}

function validateTemplateNode(
  mutation: Extract<Mutation, { kind: "schema-template-node-add" | "schema-template-node-remove" }>,
  previous: Projection,
  available: Projection,
): void {
  const removing = mutation.kind === "schema-template-node-remove";
  requireDefinition(available, mutation.schemaId, "Schema", removing);
  if (!removing) {
    validateTemplateNodeAddition(mutation, previous, available);
    return;
  }
  const occurrence = previous.occurrences[mutation.templateOccurrenceId];
  if (
    occurrence?.nodeId !== mutation.templateNodeId ||
    occurrence.parentNodeId !== mutation.schemaId
  ) {
    throw new Error("Schema Template Node Occurrence is absent from the observed projection");
  }
  validateRelation(
    available.children[mutation.schemaId] ?? [],
    previous.children[mutation.schemaId] ?? [],
    mutation.templateOccurrenceId,
    mutation.previousAnchor,
    false,
    "Schema Template Node Occurrence",
  );
}

function validateTemplateNodeAddition(
  mutation: Extract<Mutation, { kind: "schema-template-node-add" }>,
  previous: Projection,
  available: Projection,
): void {
  requireNode(available, mutation.templateNodeId, "Template");
  const occurrence = available.occurrences[mutation.templateOccurrenceId];
  if (
    occurrence &&
    (occurrence.nodeId !== mutation.templateNodeId || occurrence.parentNodeId !== mutation.schemaId)
  ) {
    throw new Error("Template Node Occurrence identity already exists");
  }
  const existing = templateOccurrenceFor(available, mutation.schemaId, mutation.templateNodeId);
  if (existing && existing !== mutation.templateOccurrenceId) {
    throw new Error("Schema already contains the Template Node");
  }
  validateRelation(
    available.children[mutation.schemaId] ?? [],
    previous.children[mutation.schemaId] ?? [],
    mutation.templateOccurrenceId,
    mutation.anchor,
    true,
    "Schema Template Node Occurrence",
  );
}

function validateTemplateField(
  mutation: Extract<Mutation, { kind: "schema-field-add" | "schema-field-remove" }>,
  previous: Projection,
  available: Projection,
): void {
  const removing = mutation.kind === "schema-field-remove";
  requireDefinition(available, mutation.schemaId, "Schema", removing);
  requireDefinition(available, mutation.fieldDefinitionId, "Field Definition", removing);
  if (!removing) {
    const existing = available.templateFields[mutation.schemaId]?.find(
      (field) => field.fieldNodeId === mutation.fieldNodeId,
    );
    const occurrence = available.occurrences[mutation.fieldOccurrenceId];
    const matchingCreation =
      available.nodes[mutation.fieldNodeId] !== undefined &&
      occurrence?.nodeId === mutation.fieldNodeId &&
      occurrence.parentNodeId === mutation.schemaId;
    if (
      (available.nodes[mutation.fieldNodeId] ||
        available.occurrences[mutation.fieldOccurrenceId]) &&
      !matchingCreation &&
      (existing?.fieldDefinitionId !== mutation.fieldDefinitionId ||
        existing.fieldOccurrenceId !== mutation.fieldOccurrenceId)
    ) {
      throw new Error("Template Field Node or Occurrence identity already exists");
    }
    if (
      (available.templateFields[mutation.schemaId] ?? []).some(
        (field) =>
          field.fieldNodeId !== mutation.fieldNodeId &&
          field.fieldDefinitionId === mutation.fieldDefinitionId,
      )
    ) {
      throw new Error("Schema already contains the Template Field or Field Definition");
    }
    validateRelation(
      available.children[mutation.schemaId] ?? [],
      previous.children[mutation.schemaId] ?? [],
      mutation.fieldOccurrenceId,
      mutation.anchor,
      true,
      "Template Field Occurrence",
    );
    return;
  }
  const previousField = previous.templateFields[mutation.schemaId]?.find(
    (field) => field.fieldNodeId === mutation.fieldNodeId,
  );
  if (
    previousField?.fieldDefinitionId !== mutation.fieldDefinitionId ||
    previousField.fieldOccurrenceId !== mutation.fieldOccurrenceId ||
    canonicalJson(
      anchorAt(
        previous.children[mutation.schemaId] ?? [],
        (previous.children[mutation.schemaId] ?? []).indexOf(mutation.fieldOccurrenceId),
      ),
    ) !== canonicalJson(mutation.previousAnchor)
  ) {
    throw new Error("Template Field binding is absent from the observed projection");
  }
}

function templateOccurrenceFor(
  projection: Projection,
  schemaId: string,
  templateNodeId: string,
): string | null {
  return (
    Object.values(projection.occurrences)
      .filter(
        (occurrence) =>
          occurrence.parentNodeId === schemaId && occurrence.nodeId === templateNodeId,
      )
      .map((occurrence) => occurrence.occurrenceId)
      .sort()[0] ?? null
  );
}

function requireDefinition(
  projection: Projection,
  definitionId: string,
  label: string,
  allowDeleted: boolean,
): void {
  if (
    projection.nodes[definitionId] ||
    (allowDeleted && projection.nodeStatuses[definitionId]?.state === "deleted")
  ) {
    return;
  }
  throw new Error(`${label} Definition is deleted or absent from the observed projection`);
}

function validateRelation(
  available: readonly string[],
  previous: readonly string[],
  identity: string,
  anchor: SequenceAnchor | undefined,
  adding: boolean,
  label: string,
): void {
  if (adding) {
    if (
      !anchor ||
      [anchor.after, anchor.before].some((id) => id !== null && !available.includes(id))
    ) {
      throw new Error(`${label} anchor is absent from the observed projection`);
    }
    return;
  }
  const index = previous.indexOf(identity);
  if (index < 0) {
    throw new Error(`${label} is absent from the observed projection`);
  }
  if (canonicalJson(anchorAt(previous, index)) !== canonicalJson(anchor)) {
    throw new Error(`${label} previous anchor does not match the observed projection`);
  }
}

function requireNode(projection: Projection, nodeId: string, label: string): void {
  if (!projection.nodes[nodeId]) {
    throw new Error(`${label} Node is absent from the observed projection`);
  }
}

function anchorAt(identities: readonly string[], index: number): SequenceAnchor {
  return {
    after: identities[index - 1] ?? null,
    before: identities[index + 1] ?? null,
    affinity: index === 0 ? "before" : "after",
    fallback: index === 0 ? "start" : "end",
  };
}
