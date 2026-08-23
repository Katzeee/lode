import { FIELD_DATATYPE_NODE_IDS, parseAuthoredAction } from "../fact/index.js";
import type { ConfigureFieldDefinitionEdit } from "./field-definition-configuration-edit-types.js";

export function parseFieldDefinitionConfigure(edit: Record<string, unknown>): ConfigureFieldDefinitionEdit {
  const kind = edit.kind;
  const fieldDefinitionId = nonemptyString(edit.fieldDefinitionId, "Field Definition identity");
  if (kind === "field-datatype-configure") {
    exactKeys(edit, ["kind", "fieldDefinitionId", "datatypeNodeId", "optionsSupertagId"]);
    const datatypeNodeId = nonemptyString(edit.datatypeNodeId, "Field Datatype endpoint Node identity");
    const optionsSupertagId = optionalOptionsSource(edit.optionsSupertagId, datatypeNodeId);
    return {
      kind,
      fieldDefinitionId,
      datatypeNodeId,
      ...(optionsSupertagId === undefined ? {} : { optionsSupertagId }),
    };
  }
  if (kind === "field-cardinality-configure") {
    exactKeys(edit, ["kind", "fieldDefinitionId", "cardinalityNodeId"]);
    return {
      kind,
      fieldDefinitionId,
      cardinalityNodeId: nonemptyString(edit.cardinalityNodeId, "Field Cardinality endpoint Node identity"),
    };
  }
  if (kind === "field-optionality-configure") {
    exactKeys(edit, ["kind", "fieldDefinitionId", "optionalityNodeId"]);
    return {
      kind,
      fieldDefinitionId,
      optionalityNodeId: nonemptyString(edit.optionalityNodeId, "Field Optionality endpoint Node identity"),
    };
  }
  exactKeys(edit, ["kind", "fieldDefinitionId", "expression"]);
  const action = parseAuthoredAction({
    kind: "field-configuration-set",
    fieldDefinitionId,
    configuration: { kind: "initialization-expression", expression: edit.expression },
  });
  if (action.kind !== "field-configuration-set" || action.configuration.kind !== "initialization-expression") {
    throw new Error("Field Initialization Expression is invalid");
  }
  return {
    kind: "field-initialization-expression-configure",
    fieldDefinitionId,
    expression: action.configuration.expression,
  };
}

function optionalOptionsSource(value: unknown, datatypeNodeId: string): string | undefined {
  if (datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.optionsFromSupertag) {
    if (value !== undefined) {
      throw new Error("Only Options from Supertag accepts a source Supertag");
    }
    return undefined;
  }
  return nonemptyString(value, "Options source Supertag identity");
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(`Unknown edit property: ${key}`);
    }
  }
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
