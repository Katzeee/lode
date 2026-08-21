import { atomicMutationWrite, type EditMutation, type MutationWrite } from "../../../domain/edit/index.js";
import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  OPTIONAL_FIELDS_DEFINITION_NODE_ID,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  workspaceSchemaNodeId,
  type Mutation,
} from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

type OptionalFieldEdit = Extract<EditMutation, { kind: "supertag-optional-field-contribution-add" }>;

export function prepareSupertagOptionalFieldContributionAddition(
  edit: OptionalFieldEdit,
  available: ScopedProjection,
): MutationWrite {
  const { createMetanode, createNursery } = optionalFieldCreationState(edit, available);
  assertUnusedIdentities(
    available,
    [
      ...(createMetanode ? [edit.metanodeId] : []),
      ...(createNursery ? [edit.fieldNurseryNodeId, edit.nurseryValueNodeId] : []),
      edit.contributionNodeId,
      edit.valueNodeId,
    ],
    [
      ...(createNursery
        ? [edit.fieldNurseryOccurrenceId, edit.nurseryDefinitionOccurrenceId, edit.nurseryValueOccurrenceId]
        : []),
      edit.contributionOccurrenceId,
      edit.definitionOccurrenceId,
      edit.valueOccurrenceId,
    ],
  );
  const mutations: Mutation[] = [
    ...(createMetanode
      ? [
          { kind: "node-create" as const, nodeId: edit.metanodeId },
          owner(edit.metanodeId, edit.supertagId, null),
          { kind: "metanode-attach" as const, hostNodeId: edit.supertagId, metanodeId: edit.metanodeId },
        ]
      : []),
    ...(createNursery ? nurseryCreationMutations(edit) : []),
    { kind: "node-create", nodeId: edit.contributionNodeId },
    owner(edit.contributionNodeId, edit.nurseryValueNodeId, null),
    occurrence(edit.contributionOccurrenceId, edit.contributionNodeId, edit.nurseryValueNodeId, edit.anchor),
    occurrence(edit.definitionOccurrenceId, edit.fieldDefinitionId, edit.contributionNodeId, end),
    { kind: "node-create", nodeId: edit.valueNodeId },
    owner(edit.valueNodeId, edit.contributionNodeId, null),
    occurrence(edit.valueOccurrenceId, edit.valueNodeId, edit.contributionNodeId, after(edit.definitionOccurrenceId)),
    optionalFieldAttachMutation(edit),
  ];
  const first = mutations[0];
  if (first === undefined) {
    throw new Error("Optional Field authoring must produce mutations");
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
}

function optionalFieldCreationState(
  edit: OptionalFieldEdit,
  available: ScopedProjection,
): Readonly<{ createMetanode: boolean; createNursery: boolean }> {
  if (available.nodes[edit.supertagId]?.intrinsicNodeType !== SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE) {
    throw new Error("Optional Field host is not an active Supertag Definition");
  }
  if (
    available.nodes[edit.fieldDefinitionId]?.intrinsicNodeType !== FIELD_DEFINITION_INTRINSIC_NODE_TYPE ||
    available.nodeOwners[edit.fieldDefinitionId] !== workspaceSchemaNodeId(available.identity.workspaceNodeId)
  ) {
    throw new Error("Optional Field endpoint is not a discoverable Field Definition");
  }
  if (
    (available.templateFields[edit.supertagId] ?? []).some(
      (field) => field.fieldDefinitionId === edit.fieldDefinitionId,
    ) ||
    (available.optionalFieldContributions[edit.supertagId] ?? []).some(
      (field) => field.fieldDefinitionId === edit.fieldDefinitionId,
    )
  ) {
    throw new Error("Supertag already exposes this Field Definition");
  }
  const existingMetanode = available.metanodes[edit.supertagId];
  if (existingMetanode !== undefined && existingMetanode !== edit.metanodeId) {
    throw new Error("Optional Field Metanode identity does not match the Supertag Definition");
  }
  const existingContribution = (available.optionalFieldContributions[edit.supertagId] ?? [])[0];
  if (existingContribution !== undefined && existingContribution.fieldNurseryNodeId !== edit.fieldNurseryNodeId) {
    throw new Error("Optional Field Nursery identity does not match the Supertag Definition");
  }
  return { createMetanode: existingMetanode === undefined, createNursery: existingContribution === undefined };
}

function nurseryCreationMutations(edit: OptionalFieldEdit): Mutation[] {
  return [
    { kind: "node-create", nodeId: edit.fieldNurseryNodeId },
    owner(edit.fieldNurseryNodeId, edit.metanodeId, null),
    occurrence(edit.fieldNurseryOccurrenceId, edit.fieldNurseryNodeId, edit.metanodeId, end),
    occurrence(edit.nurseryDefinitionOccurrenceId, OPTIONAL_FIELDS_DEFINITION_NODE_ID, edit.fieldNurseryNodeId, end),
    { kind: "node-create", nodeId: edit.nurseryValueNodeId },
    owner(edit.nurseryValueNodeId, edit.fieldNurseryNodeId, null),
    occurrence(
      edit.nurseryValueOccurrenceId,
      edit.nurseryValueNodeId,
      edit.fieldNurseryNodeId,
      after(edit.nurseryDefinitionOccurrenceId),
    ),
  ];
}

function optionalFieldAttachMutation(edit: OptionalFieldEdit): Mutation {
  return {
    kind: "supertag-optional-field-contribution-attach",
    supertagId: edit.supertagId,
    fieldNurseryNodeId: edit.fieldNurseryNodeId,
    fieldNurseryOccurrenceId: edit.fieldNurseryOccurrenceId,
    nurseryDefinitionOccurrenceId: edit.nurseryDefinitionOccurrenceId,
    nurseryValueNodeId: edit.nurseryValueNodeId,
    nurseryValueOccurrenceId: edit.nurseryValueOccurrenceId,
    contributionNodeId: edit.contributionNodeId,
    contributionOccurrenceId: edit.contributionOccurrenceId,
    fieldDefinitionId: edit.fieldDefinitionId,
    definitionOccurrenceId: edit.definitionOccurrenceId,
    valueNodeId: edit.valueNodeId,
    valueOccurrenceId: edit.valueOccurrenceId,
    anchor: edit.anchor,
  };
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
    throw new Error("Optional Field Node or Occurrence identity already exists");
  }
}
