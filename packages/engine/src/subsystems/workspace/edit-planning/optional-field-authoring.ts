import type { EditAction } from "../../../domain/edit/index.js";
import {
  FIELD_DEFINITION_INTRINSIC_NODE_TYPE,
  SUPERTAG_DEFINITION_INTRINSIC_NODE_TYPE,
  workspaceSchemaNodeId,
} from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";
import { singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";

export function prepareSupertagOptionalFieldContributionAddition(
  edit: Extract<EditAction, { kind: "supertag-optional-field-contribution-add" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
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
  return singleAuthoredActionBatch({
    kind: "optional-field-contribution-add",
    supertagId: edit.supertagId,
    fieldDefinitionId: edit.fieldDefinitionId,
    anchor: edit.anchor,
  });
}

export function prepareSupertagOptionalFieldContributionRemoval(
  edit: Extract<EditAction, { kind: "supertag-optional-field-contribution-remove" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  if (
    !(available.optionalFieldContributions[edit.supertagId] ?? []).some(
      (field) => field.fieldDefinitionId === edit.fieldDefinitionId,
    )
  ) {
    throw new Error("Optional Field Contribution is absent");
  }
  return singleAuthoredActionBatch({
    kind: "optional-field-contribution-remove",
    supertagId: edit.supertagId,
    fieldDefinitionId: edit.fieldDefinitionId,
  });
}
