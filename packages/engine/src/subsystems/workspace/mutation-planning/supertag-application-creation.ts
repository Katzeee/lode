import { atomicMutationWrite, type EditMutation, type MutationWrite } from "../../../domain/edit/index.js";
import {
  NODE_SUPERTAGS_DEFINITION_NODE_ID,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  templateFieldInstanceNodeId,
  templateFieldInstanceOccurrenceId,
  templateFieldInstanceValueNodeId,
  templateFieldInstanceValueOccurrenceId,
  type Mutation,
} from "../../../domain/fact/index.js";
import { projectFieldAvailability, type ScopedProjection } from "../../../domain/reconcile/index.js";

type SupertagApplicationCreation = Extract<EditMutation, { kind: "supertag-application-create" }>;

export function prepareSupertagApplicationCreation(
  edit: SupertagApplicationCreation,
  available: ScopedProjection,
): MutationWrite {
  if (available.nodes[edit.hostNodeId] === undefined) {
    throw new Error("Supertag Application host is not an active Node");
  }
  if (available.nodes[edit.supertagId]?.intrinsicNodeType !== SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE) {
    throw new Error("Supertag Application endpoint is not an active Supertag Definition");
  }
  const existingMetanode = available.metanodes[edit.hostNodeId];
  if (existingMetanode !== undefined && existingMetanode !== edit.metanodeId) {
    throw new Error("Supertag Application Metanode identity does not match the host");
  }
  if ((available.supertagApplications[edit.hostNodeId] ?? []).some((item) => item.supertagId === edit.supertagId)) {
    throw new Error("Node already has this Supertag Application");
  }
  if (
    available.nodes[edit.applicationNodeId] !== undefined ||
    available.occurrences[edit.applicationOccurrenceId] !== undefined ||
    available.occurrences[edit.relationDefinitionOccurrenceId] !== undefined ||
    available.occurrences[edit.definitionOccurrenceId] !== undefined
  ) {
    throw new Error("Supertag Application Node or Occurrence identity already exists");
  }
  const rootMutations: Mutation[] =
    existingMetanode === undefined
      ? [
          { kind: "node-create", nodeId: edit.metanodeId },
          {
            kind: "node-owner-set",
            nodeId: edit.metanodeId,
            ownerNodeId: edit.hostNodeId,
            previousOwnerNodeId: null,
          },
          { kind: "metanode-attach", hostNodeId: edit.hostNodeId, metanodeId: edit.metanodeId },
        ]
      : [];
  const mutations: Mutation[] = [
    ...rootMutations,
    {
      kind: "node-create",
      nodeId: edit.applicationNodeId,
      ...(edit.seed === undefined ? {} : { seed: edit.seed }),
    },
    {
      kind: "node-owner-set",
      nodeId: edit.applicationNodeId,
      ownerNodeId: edit.metanodeId,
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-create",
      occurrenceId: edit.applicationOccurrenceId,
      nodeId: edit.applicationNodeId,
      parentNodeId: edit.metanodeId,
      anchor: edit.anchor,
    },
    {
      kind: "occurrence-create",
      occurrenceId: edit.relationDefinitionOccurrenceId,
      nodeId: NODE_SUPERTAGS_DEFINITION_NODE_ID,
      parentNodeId: edit.applicationNodeId,
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
    {
      kind: "occurrence-create",
      occurrenceId: edit.definitionOccurrenceId,
      nodeId: edit.supertagId,
      parentNodeId: edit.applicationNodeId,
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
    },
    {
      kind: "supertag-apply",
      hostNodeId: edit.hostNodeId,
      supertagId: edit.supertagId,
      applicationNodeId: edit.applicationNodeId,
      applicationOccurrenceId: edit.applicationOccurrenceId,
      relationDefinitionOccurrenceId: edit.relationDefinitionOccurrenceId,
      definitionOccurrenceId: edit.definitionOccurrenceId,
      anchor: edit.anchor,
    },
    ...materializeStaticDefaults(edit.hostNodeId, edit.supertagId, edit.applicationNodeId, available),
  ];
  const first = mutations[0];
  if (!first) {
    throw new Error("Supertag Application creation must produce mutations");
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
}

function materializeStaticDefaults(
  ownerNodeId: string,
  appliedSupertagId: string,
  applicationNodeId: string,
  available: ScopedProjection,
): readonly Mutation[] {
  const applications = {
    ...available.supertagApplications,
    [ownerNodeId]: [
      ...(available.supertagApplications[ownerNodeId] ?? []),
      {
        hostNodeId: ownerNodeId,
        supertagId: appliedSupertagId,
        applicationNodeId,
        applicationOccurrenceId: "pending",
        relationDefinitionOccurrenceId: "pending",
        definitionOccurrenceId: "pending",
        contributionId: "pending",
      },
    ],
  };
  const projected = projectFieldAvailability(
    applications,
    available.templateFields,
    available.optionalFieldContributions,
    available.supertagExtensions,
    available.materializedFields,
    available.nodes,
  );
  const mutations: Mutation[] = [];
  for (const field of projected.effectiveFields[ownerNodeId] ?? []) {
    const fieldDefinitionId = field.fieldDefinitionId;
    if (
      (available.materializedFields[ownerNodeId] ?? []).some((field) => field.fieldDefinitionId === fieldDefinitionId)
    ) {
      continue;
    }
    if (field.staticDefault.state !== "value") {
      continue;
    }
    const sourceTemplateFieldNodeId = field.staticDefault.sourceTemplateFieldNodeId;
    const fieldNodeId = templateFieldInstanceNodeId(ownerNodeId, sourceTemplateFieldNodeId);
    const fieldOccurrenceId = templateFieldInstanceOccurrenceId(ownerNodeId, sourceTemplateFieldNodeId);
    const valueNodeId = templateFieldInstanceValueNodeId(ownerNodeId, sourceTemplateFieldNodeId);
    const valueOccurrenceId = templateFieldInstanceValueOccurrenceId(ownerNodeId, sourceTemplateFieldNodeId);
    if (
      available.nodes[fieldNodeId] !== undefined ||
      available.nodes[valueNodeId] !== undefined ||
      available.occurrences[fieldOccurrenceId] !== undefined ||
      available.occurrences[valueOccurrenceId] !== undefined
    ) {
      throw new Error("Static default materialization identity already exists");
    }
    mutations.push(
      { kind: "field-materialize", ownerNodeId, fieldDefinitionId, fieldNodeId, fieldOccurrenceId },
      {
        kind: "node-create",
        nodeId: valueNodeId,
        seed: { text: [{ value: field.staticDefault.value, attributes: {} }] },
      },
      { kind: "node-owner-set", nodeId: valueNodeId, ownerNodeId: fieldNodeId, previousOwnerNodeId: null },
      {
        kind: "occurrence-create",
        occurrenceId: valueOccurrenceId,
        nodeId: valueNodeId,
        parentNodeId: fieldNodeId,
        anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      },
    );
  }
  return mutations;
}
