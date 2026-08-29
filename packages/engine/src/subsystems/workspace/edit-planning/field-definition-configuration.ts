import type { ConfigureFieldDefinitionEdit } from "../../../domain/edit/index.js";
import {
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_DATATYPE_NODE_IDS,
  FIELD_OPTIONALITY_NODE_IDS,
  type FieldDefinitionConfigurationValue,
} from "../../../domain/fact/index.js";
import type { InterpretedProjection } from "../../../domain/reconcile/index.js";
import { singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";

export function prepareFieldDefinitionConfiguration(
  edit: ConfigureFieldDefinitionEdit,
  available: InterpretedProjection,
): AuthoredActionBatch {
  if (available.nodes[edit.fieldDefinitionId]?.intrinsicNodeType !== "field-definition") {
    throw new Error("Field configuration host is not an active Field Definition Node");
  }
  const configuration = configurationValue(edit);
  if (
    configuration.kind === "initialization-expression" &&
    configuration.expression.sourceFieldDefinitionId !== edit.fieldDefinitionId
  ) {
    throw new Error("Ancestor Field initialization reads the configured Field Definition");
  }
  if (
    configuration.kind === "datatype" &&
    configuration.optionsSupertagId !== undefined &&
    available.nodes[configuration.optionsSupertagId]?.intrinsicNodeType !== "supertag-definition"
  ) {
    throw new Error("Options source is not an active Supertag Definition");
  }
  return singleAuthoredActionBatch({
    kind: "field-configuration-set",
    fieldDefinitionId: edit.fieldDefinitionId,
    configuration,
  });
}

function configurationValue(edit: ConfigureFieldDefinitionEdit): FieldDefinitionConfigurationValue {
  if (edit.kind === "field-datatype-configure") {
    assertBuiltin(edit.datatypeNodeId, Object.values(FIELD_DATATYPE_NODE_IDS), "Field Datatype");
    return {
      kind: "datatype",
      datatypeNodeId: edit.datatypeNodeId,
      ...(edit.optionsSupertagId === undefined ? {} : { optionsSupertagId: edit.optionsSupertagId }),
    };
  }
  if (edit.kind === "field-cardinality-configure") {
    assertBuiltin(edit.cardinalityNodeId, Object.values(FIELD_CARDINALITY_NODE_IDS), "Field Cardinality");
    return { kind: "cardinality", cardinalityNodeId: edit.cardinalityNodeId };
  }
  if (edit.kind === "field-optionality-configure") {
    assertBuiltin(edit.optionalityNodeId, Object.values(FIELD_OPTIONALITY_NODE_IDS), "Field Optionality");
    return { kind: "optionality", optionalityNodeId: edit.optionalityNodeId };
  }
  return { kind: "initialization-expression", expression: edit.expression };
}

function assertBuiltin(value: string, supported: readonly string[], label: string): void {
  if (!supported.includes(value)) {
    throw new Error(`${label} is not a built-in System Definition`);
  }
}
