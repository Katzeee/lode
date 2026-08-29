import { FIELD_DATATYPE_NODE_IDS, parseAuthoredAction } from "../fact/index.js";
import type { ConfigureFieldDefinitionEdit } from "./field-definition-configuration-edit-types.js";
import { exactInputKeys, nonemptyInputString } from "./input-validation-primitives.js";

export function parseFieldDefinitionConfigure(edit: Record<string, unknown>): ConfigureFieldDefinitionEdit {
  const kind = edit.kind;
  const fieldDefinitionId = nonemptyInputString(edit.fieldDefinitionId, "Field Definition identity");
  if (kind === "field-datatype-configure") {
    exactInputKeys(edit, ["kind", "fieldDefinitionId", "datatypeNodeId", "optionsSupertagId"]);
    const datatypeNodeId = nonemptyInputString(edit.datatypeNodeId, "Field Datatype endpoint Node identity");
    const optionsSupertagId = optionalOptionsSource(edit.optionsSupertagId, datatypeNodeId);
    return {
      kind,
      fieldDefinitionId,
      datatypeNodeId,
      ...(optionsSupertagId === undefined ? {} : { optionsSupertagId }),
    };
  }
  if (kind === "field-cardinality-configure") {
    exactInputKeys(edit, ["kind", "fieldDefinitionId", "cardinalityNodeId"]);
    return {
      kind,
      fieldDefinitionId,
      cardinalityNodeId: nonemptyInputString(edit.cardinalityNodeId, "Field Cardinality endpoint Node identity"),
    };
  }
  if (kind === "field-optionality-configure") {
    exactInputKeys(edit, ["kind", "fieldDefinitionId", "optionalityNodeId"]);
    return {
      kind,
      fieldDefinitionId,
      optionalityNodeId: nonemptyInputString(edit.optionalityNodeId, "Field Optionality endpoint Node identity"),
    };
  }
  exactInputKeys(edit, ["kind", "fieldDefinitionId", "expression"]);
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
  return nonemptyInputString(value, "Options source Supertag identity");
}
