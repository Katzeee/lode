import { requireAuthoredActionBatch, type AuthoredActionBatch } from "../action-batch.js";
import {
  END_SEQUENCE_ANCHOR as END,
  fieldDefinitionEndpointOccurrenceId,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  type FieldAction,
  START_SEQUENCE_ANCHOR as START,
} from "../../../../domain/fact/index.js";
import type { InterpretedProjection } from "../../../../domain/reconcile/index.js";
import { createNodeUnlessPresent, createOccurrenceUnlessPresent } from "./generated-lifecycle.js";

export function expandFieldAction(action: FieldAction, available: InterpretedProjection): AuthoredActionBatch {
  switch (action.kind) {
    case "field-materialize": {
      const fieldNodeId = materializedFieldNodeId(action.ownerNodeId, action.fieldDefinitionId);
      const fieldOccurrenceId = materializedFieldOccurrenceId(action.ownerNodeId, action.fieldDefinitionId);
      return requireAuthoredActionBatch([
        ...createNodeUnlessPresent(
          fieldNodeId,
          action.ownerNodeId,
          { placementId: fieldOccurrenceId, anchor: END },
          available,
          { intrinsicNodeType: "field" },
        ),
        ...createOccurrenceUnlessPresent(
          fieldDefinitionEndpointOccurrenceId(fieldOccurrenceId),
          action.fieldDefinitionId,
          fieldNodeId,
          START,
          available,
        ),
        action,
      ]);
    }
    case "field-value-remove":
    case "materialized-field-clear":
      return requireAuthoredActionBatch([action]);
  }
}
