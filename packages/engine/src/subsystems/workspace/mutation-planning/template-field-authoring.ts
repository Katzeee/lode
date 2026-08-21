import {
  atomicMutationWrite,
  singleMutationWrite,
  type EditMutation,
  type MutationWrite,
} from "../../../domain/edit/index.js";
import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  FIELD_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  workspaceSchemaNodeId,
  type Mutation,
} from "../../../domain/fact/index.js";
import { occurrenceAnchor, textAtoms, type ScopedProjection } from "../../../domain/reconcile/index.js";

export function prepareSupertagTemplateFieldCreation(
  edit: Extract<EditMutation, { kind: "supertag-template-field-create" }>,
  available: ScopedProjection,
): MutationWrite {
  if (available.nodes[edit.supertagId]?.intrinsicNodeType !== SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE) {
    throw new Error("Template Field host is not an active Supertag Definition");
  }
  assertUnusedIdentities(
    available,
    [edit.templateFieldNodeId, edit.fieldDefinitionId, edit.staticDefaultValueNodeId],
    [edit.templateFieldOccurrenceId, edit.definitionOccurrenceId, edit.staticDefaultValueOccurrenceId],
  );
  assertFieldDefinitionIsNotExposed(available, edit.supertagId, edit.fieldDefinitionId);
  return nonemptyAtomic([
    { kind: "node-create", nodeId: edit.templateFieldNodeId },
    owner(edit.templateFieldNodeId, edit.supertagId, null),
    occurrence(edit.templateFieldOccurrenceId, edit.templateFieldNodeId, edit.supertagId, edit.anchor),
    {
      kind: "intrinsic-node-type-declare",
      nodeId: edit.templateFieldNodeId,
      intrinsicNodeType: FIELD_INTRINSIC_NODE_TYPE,
    },
    {
      kind: "node-create",
      nodeId: edit.fieldDefinitionId,
      ...(edit.fieldDefinitionSeed === undefined ? {} : { seed: edit.fieldDefinitionSeed }),
    },
    owner(edit.fieldDefinitionId, edit.templateFieldNodeId, null),
    {
      kind: "intrinsic-node-type-declare",
      nodeId: edit.fieldDefinitionId,
      intrinsicNodeType: FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
    },
    occurrence(edit.definitionOccurrenceId, edit.fieldDefinitionId, edit.templateFieldNodeId, end),
    { kind: "node-create", nodeId: edit.staticDefaultValueNodeId },
    owner(edit.staticDefaultValueNodeId, edit.templateFieldNodeId, null),
    occurrence(
      edit.staticDefaultValueOccurrenceId,
      edit.staticDefaultValueNodeId,
      edit.templateFieldNodeId,
      after(edit.definitionOccurrenceId),
    ),
    {
      kind: "supertag-template-field-attach",
      supertagId: edit.supertagId,
      templateFieldNodeId: edit.templateFieldNodeId,
      templateFieldOccurrenceId: edit.templateFieldOccurrenceId,
      fieldDefinitionId: edit.fieldDefinitionId,
      definitionOccurrenceId: edit.definitionOccurrenceId,
      staticDefaultValueNodeId: edit.staticDefaultValueNodeId,
      staticDefaultValueOccurrenceId: edit.staticDefaultValueOccurrenceId,
      anchor: edit.anchor,
    },
  ]);
}

export function prepareExistingSupertagTemplateFieldAddition(
  edit: Extract<EditMutation, { kind: "supertag-template-field-add-existing" }>,
  available: ScopedProjection,
): MutationWrite {
  if (available.nodes[edit.supertagId]?.intrinsicNodeType !== SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE) {
    throw new Error("Template Field host is not an active Supertag Definition");
  }
  if (
    available.nodes[edit.fieldDefinitionId]?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
    available.nodeOwners[edit.fieldDefinitionId] !== workspaceSchemaNodeId(available.identity.workspaceNodeId)
  ) {
    throw new Error("Template Field endpoint is not a discoverable Field Definition");
  }
  assertUnusedIdentities(
    available,
    [edit.templateFieldNodeId, edit.staticDefaultValueNodeId],
    [edit.templateFieldOccurrenceId, edit.definitionOccurrenceId, edit.staticDefaultValueOccurrenceId],
  );
  assertFieldDefinitionIsNotExposed(available, edit.supertagId, edit.fieldDefinitionId);
  return nonemptyAtomic([
    { kind: "node-create", nodeId: edit.templateFieldNodeId },
    owner(edit.templateFieldNodeId, edit.supertagId, null),
    occurrence(edit.templateFieldOccurrenceId, edit.templateFieldNodeId, edit.supertagId, edit.anchor),
    {
      kind: "intrinsic-node-type-declare",
      nodeId: edit.templateFieldNodeId,
      intrinsicNodeType: FIELD_INTRINSIC_NODE_TYPE,
    },
    occurrence(edit.definitionOccurrenceId, edit.fieldDefinitionId, edit.templateFieldNodeId, end),
    { kind: "node-create", nodeId: edit.staticDefaultValueNodeId },
    owner(edit.staticDefaultValueNodeId, edit.templateFieldNodeId, null),
    occurrence(
      edit.staticDefaultValueOccurrenceId,
      edit.staticDefaultValueNodeId,
      edit.templateFieldNodeId,
      after(edit.definitionOccurrenceId),
    ),
    {
      kind: "supertag-template-field-existing-attach",
      supertagId: edit.supertagId,
      templateFieldNodeId: edit.templateFieldNodeId,
      templateFieldOccurrenceId: edit.templateFieldOccurrenceId,
      fieldDefinitionId: edit.fieldDefinitionId,
      definitionOccurrenceId: edit.definitionOccurrenceId,
      staticDefaultValueNodeId: edit.staticDefaultValueNodeId,
      staticDefaultValueOccurrenceId: edit.staticDefaultValueOccurrenceId,
      anchor: edit.anchor,
    },
  ]);
}

export function prepareSupertagTemplateFieldDiscoverability(
  edit: Extract<EditMutation, { kind: "supertag-template-field-make-discoverable" }>,
  available: ScopedProjection,
): MutationWrite {
  const field = (available.templateFields[edit.supertagId] ?? []).find(
    (candidate) =>
      candidate.templateFieldNodeId === edit.templateFieldNodeId &&
      candidate.fieldDefinitionId === edit.fieldDefinitionId,
  );
  if (field?.fieldDefinitionOwner !== "template-field") {
    throw new Error("Template Field is absent or already discoverable");
  }
  const schemaNodeId = workspaceSchemaNodeId(available.identity.workspaceNodeId);
  if (available.workspaceSystemNodes.schema !== schemaNodeId) {
    throw new Error("Workspace Schema is absent");
  }
  return atomicMutationWrite([
    {
      kind: "supertag-template-field-discoverability-set",
      supertagId: edit.supertagId,
      templateFieldNodeId: edit.templateFieldNodeId,
      fieldDefinitionId: edit.fieldDefinitionId,
      discoverable: true,
      previousDiscoverable: false,
    },
    owner(edit.fieldDefinitionId, schemaNodeId, edit.templateFieldNodeId),
  ]);
}

export function prepareSupertagTemplateFieldRemoval(
  edit: Extract<EditMutation, { kind: "supertag-template-field-remove" }>,
  available: ScopedProjection,
): MutationWrite {
  const field = (available.templateFields[edit.supertagId] ?? []).find(
    (candidate) => candidate.templateFieldNodeId === edit.templateFieldNodeId,
  );
  if (field === undefined) {
    throw new Error("Template Field is absent from the Supertag Definition");
  }
  if (field.fieldDefinitionOwner !== "workspace-schema") {
    throw new Error("A private Template Field must become discoverable before removal");
  }
  const trashNodeId = available.workspaceSystemNodes.trash;
  if (trashNodeId === undefined) {
    throw new Error("Workspace Trash is absent");
  }
  const previousAnchor = occurrenceAnchor(available, field.templateFieldOccurrenceId);
  return atomicMutationWrite([
    {
      kind: "supertag-template-field-detach",
      supertagId: field.supertagId,
      templateFieldNodeId: field.templateFieldNodeId,
      templateFieldOccurrenceId: field.templateFieldOccurrenceId,
      fieldDefinitionId: field.fieldDefinitionId,
      definitionOccurrenceId: field.definitionOccurrenceId,
      staticDefaultValueNodeId: field.staticDefaultValueNodeId,
      staticDefaultValueOccurrenceId: field.staticDefaultValueOccurrenceId,
      previousAnchor,
    },
    { kind: "node-delete", nodeId: field.templateFieldNodeId },
    owner(field.templateFieldNodeId, trashNodeId, field.supertagId),
    {
      kind: "occurrence-move",
      occurrenceId: field.templateFieldOccurrenceId,
      parentNodeId: trashNodeId,
      anchor: end,
      previousParentNodeId: field.supertagId,
      previousAnchor,
    },
  ]);
}

export function prepareSupertagTemplateFieldVisibility(
  edit: Extract<EditMutation, { kind: "supertag-template-field-visibility-set" }>,
  available: ScopedProjection,
): MutationWrite {
  const field = (available.templateFields[edit.supertagId] ?? []).find(
    (candidate) => candidate.templateFieldNodeId === edit.templateFieldNodeId,
  );
  if (field === undefined) {
    throw new Error("Template Field is absent from the Supertag Definition");
  }
  if (field.visibility === edit.visibility && !field.visibilityConflicted) {
    throw new Error("Template Field already has this visibility");
  }
  return singleMutationWrite({
    kind: "supertag-template-field-visibility-configure",
    supertagId: field.supertagId,
    templateFieldNodeId: field.templateFieldNodeId,
    fieldDefinitionId: field.fieldDefinitionId,
    visibility: edit.visibility,
    previousVisibility: field.visibility,
    observedVisibilityFactIds: field.visibilityCandidates.map((candidate) => candidate.contributionId),
  });
}

export function prepareSupertagTemplateFieldStaticDefault(
  edit: Extract<EditMutation, { kind: "supertag-template-field-static-default-set" }>,
  available: ScopedProjection,
): MutationWrite {
  const field = (available.templateFields[edit.supertagId] ?? []).find(
    (candidate) => candidate.templateFieldNodeId === edit.templateFieldNodeId,
  );
  if (field === undefined) {
    throw new Error("Template Field is absent from the Supertag Definition");
  }
  const defaultNode = available.nodes[field.staticDefaultValueNodeId];
  if (defaultNode === undefined) {
    throw new Error("Template Field Static Default slot is absent");
  }
  if (defaultNode.content.some((item) => item.kind !== "text")) {
    throw new Error("Template Field Static Default supports text content only");
  }
  const atoms = textAtoms(defaultNode);
  const current = atoms.map((atom) => atom.value).join("");
  if (current === edit.value) {
    throw new Error("Template Field already has this Static Default");
  }
  return singleMutationWrite({
    kind: "text-splice",
    nodeId: field.staticDefaultValueNodeId,
    deleteAtomIds: atoms.map((atom) => atom.id),
    anchor: end,
    insert: edit.value,
  });
}

const end = { after: null, before: null, affinity: "after", fallback: "end" } as const;

function after(occurrenceId: string) {
  return { after: occurrenceId, before: null, affinity: "after", fallback: "end" } as const;
}

function owner(nodeId: string, ownerNodeId: string | null, previousOwnerNodeId: string | null): Mutation {
  return { kind: "node-owner-set", nodeId, ownerNodeId, previousOwnerNodeId };
}

function occurrence(
  occurrenceId: string,
  nodeId: string,
  parentNodeId: string,
  anchor: Extract<Mutation, { kind: "occurrence-create" }>["anchor"],
): Mutation {
  return { kind: "occurrence-create", occurrenceId, nodeId, parentNodeId, anchor };
}

function assertUnusedIdentities(
  available: ScopedProjection,
  nodeIds: readonly string[],
  occurrenceIds: readonly string[],
): void {
  if (
    nodeIds.some((nodeId) => available.nodes[nodeId] !== undefined) ||
    occurrenceIds.some((occurrenceId) => available.occurrences[occurrenceId] !== undefined)
  ) {
    throw new Error("Template Field Node or Occurrence identity already exists");
  }
}

function assertFieldDefinitionIsNotExposed(
  available: ScopedProjection,
  supertagId: string,
  fieldDefinitionId: string,
): void {
  if (
    (available.templateFields[supertagId] ?? []).some((field) => field.fieldDefinitionId === fieldDefinitionId) ||
    (available.optionalFieldContributions[supertagId] ?? []).some(
      (field) => field.fieldDefinitionId === fieldDefinitionId,
    )
  ) {
    throw new Error("Supertag already exposes this Field Definition");
  }
}

function nonemptyAtomic(mutations: readonly Mutation[]): MutationWrite {
  const first = mutations[0];
  if (first === undefined) {
    throw new Error("Template Field authoring must produce mutations");
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
}
