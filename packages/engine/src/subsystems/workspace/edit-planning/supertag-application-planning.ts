import type { EditAction } from "../../../domain/edit/index.js";
import { authoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import {
  END_SEQUENCE_ANCHOR,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  templateFieldInstanceValueNodeId,
  templateFieldInstanceValueOccurrenceId,
  type GraphAction,
} from "../../../domain/fact/index.js";
import { projectFieldAvailability, type InterpretedProjection } from "../../../domain/reconcile/index.js";
import { EditPlanningRejection } from "./planning-rejection.js";

type SupertagApplicationCreation = Extract<EditAction, { kind: "supertag-application-create" }>;

export function prepareSupertagApplicationCreation(
  edit: SupertagApplicationCreation,
  available: InterpretedProjection,
): AuthoredActionBatch {
  return authoredActionBatch([
    {
      kind: "supertag-application-add",
      hostNodeId: edit.hostNodeId,
      supertagId: edit.supertagId,
      anchor: edit.anchor,
    },
    ...materializeStaticDefaults(edit.hostNodeId, edit.supertagId, available),
  ]);
}

function materializeStaticDefaults(
  ownerNodeId: string,
  appliedSupertagId: string,
  available: InterpretedProjection,
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
      throw new EditPlanningRejection("Static default materialization identity already exists");
    }
    actions.push(
      { kind: "field-materialize", ownerNodeId, fieldDefinitionId },
      {
        kind: "node-create",
        nodeId: valueNodeId,
        ownerNodeId: fieldNodeId,
        originalPlacement: {
          placementId: valueOccurrenceId,
          anchor: END_SEQUENCE_ANCHOR,
        },
        seed: { text: [{ value: field.staticDefault.value, attributes: {} }] },
      },
    );
  }
  return actions;
}
