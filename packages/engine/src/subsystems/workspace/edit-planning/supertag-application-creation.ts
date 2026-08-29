import type { EditAction } from "../../../domain/edit/index.js";
import type { AuthoredActionBatch } from "./action-batch.js";
import {
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  templateFieldInstanceValueNodeId,
  templateFieldInstanceValueOccurrenceId,
  type GraphAction,
} from "../../../domain/fact/index.js";
import { projectFieldAvailability, type ScopedProjection } from "../../../domain/reconcile/index.js";

type SupertagApplicationCreation = Extract<EditAction, { kind: "supertag-application-create" }>;

export function prepareSupertagApplicationCreation(
  edit: SupertagApplicationCreation,
  available: ScopedProjection,
): AuthoredActionBatch {
  if (available.nodes[edit.hostNodeId] === undefined) {
    throw new Error("Supertag Application host is not an active Node");
  }
  if (available.nodes[edit.supertagId]?.intrinsicNodeType !== SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE) {
    throw new Error("Supertag Application endpoint is not an active Supertag Definition");
  }
  if ((available.supertagApplications[edit.hostNodeId] ?? []).some((item) => item.supertagId === edit.supertagId)) {
    throw new Error("Node already has this Supertag Application");
  }
  const actions: GraphAction[] = [
    {
      kind: "supertag-application-add",
      hostNodeId: edit.hostNodeId,
      supertagId: edit.supertagId,
      anchor: edit.anchor,
    },
    ...materializeStaticDefaults(edit.hostNodeId, edit.supertagId, available),
  ];
  const first = actions[0];
  if (!first) {
    throw new Error("Supertag Application creation must produce actions");
  }
  return [first, ...actions.slice(1)];
}

function materializeStaticDefaults(
  ownerNodeId: string,
  appliedSupertagId: string,
  available: ScopedProjection,
): readonly GraphAction[] {
  const applications = {
    ...available.supertagApplications,
    [ownerNodeId]: [
      ...(available.supertagApplications[ownerNodeId] ?? []),
      {
        hostNodeId: ownerNodeId,
        supertagId: appliedSupertagId,
        applicationNodeId: `pending-supertag-application:${encodeURIComponent(ownerNodeId)}:${encodeURIComponent(appliedSupertagId)}`,
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
  const actions: GraphAction[] = [];
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
    const fieldNodeId = materializedFieldNodeId(ownerNodeId, fieldDefinitionId);
    const fieldOccurrenceId = materializedFieldOccurrenceId(ownerNodeId, fieldDefinitionId);
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
    actions.push(
      { kind: "field-materialize", ownerNodeId, fieldDefinitionId },
      {
        kind: "node-create",
        nodeId: valueNodeId,
        ownerNodeId: fieldNodeId,
        originalPlacement: {
          placementId: valueOccurrenceId,
          anchor: { after: null, before: null, affinity: "after", fallback: "end" },
        },
        seed: { text: [{ value: field.staticDefault.value, attributes: {} }] },
      },
    );
  }
  return actions;
}
