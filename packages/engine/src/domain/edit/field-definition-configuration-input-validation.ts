import { parseMutation } from "../fact/index.js";
import { FIELD_DATATYPE_NODE_IDS } from "../fact/index.js";
import type { EditMutation } from "./types.js";

export function parseFieldDefinitionConfigurationCreate(edit: Record<string, unknown>): EditMutation {
  const valueKey =
    edit.kind === "field-datatype-configuration-create"
      ? "datatypeNodeId"
      : edit.kind === "field-cardinality-configuration-create"
        ? "cardinalityNodeId"
        : edit.kind === "field-optionality-configuration-create"
          ? "optionalityNodeId"
          : "expression";
  exactKeys(edit, [
    "kind",
    "fieldDefinitionId",
    "configurationNodeId",
    "configurationOccurrenceId",
    "definitionOccurrenceId",
    "anchor",
    "seed",
    ...(edit.kind === "field-initialization-expression-configuration-create" ? [] : ["valueOccurrenceId"]),
    ...(edit.kind === "field-datatype-configuration-create"
      ? ["optionsSupertagId", "optionsSupertagOccurrenceId"]
      : []),
    valueKey,
  ]);
  const fieldDefinitionId = nonemptyString(edit.fieldDefinitionId, "Field Definition identity");
  const configurationNodeId = nonemptyString(edit.configurationNodeId, "Field configuration Node identity");
  const configurationOccurrenceId = nonemptyString(
    edit.configurationOccurrenceId,
    "Field configuration Occurrence identity",
  );
  const definitionOccurrenceId = nonemptyString(
    edit.definitionOccurrenceId,
    "Field configuration Definition endpoint Occurrence identity",
  );
  const node = parseMutation({
    kind: "node-create",
    nodeId: configurationNodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: configurationOccurrenceId,
    nodeId: configurationNodeId,
    parentNodeId: fieldDefinitionId,
    anchor: edit.anchor,
  });
  const common = {
    fieldDefinitionId,
    configurationNodeId,
    configurationOccurrenceId,
    definitionOccurrenceId,
    anchor: placement.anchor,
    ...(node.seed === undefined ? {} : { seed: node.seed }),
  };
  if (edit.kind === "field-datatype-configuration-create") {
    const datatypeNodeId = nonemptyString(edit.datatypeNodeId, "Field Datatype endpoint Node identity");
    const options = optionsSupertagInput(edit, datatypeNodeId);
    return {
      kind: edit.kind,
      ...common,
      datatypeNodeId,
      valueOccurrenceId: nonemptyString(edit.valueOccurrenceId, "Field Datatype endpoint Occurrence identity"),
      ...options,
    };
  }
  if (edit.kind === "field-cardinality-configuration-create") {
    return {
      kind: edit.kind,
      ...common,
      cardinalityNodeId: nonemptyString(edit.cardinalityNodeId, "Field Cardinality endpoint Node identity"),
      valueOccurrenceId: nonemptyString(edit.valueOccurrenceId, "Field Cardinality endpoint Occurrence identity"),
    };
  }
  if (edit.kind === "field-optionality-configuration-create") {
    return {
      kind: edit.kind,
      ...common,
      optionalityNodeId: nonemptyString(edit.optionalityNodeId, "Field Optionality endpoint Node identity"),
      valueOccurrenceId: nonemptyString(edit.valueOccurrenceId, "Field Optionality endpoint Occurrence identity"),
    };
  }
  const config = parseMutation({
    kind: "field-initialization-expression-configure",
    fieldDefinitionId,
    configurationNodeId,
    configurationOccurrenceId,
    expression: edit.expression,
  });
  return { kind: "field-initialization-expression-configuration-create", ...common, expression: config.expression };
}

export function parseFieldDefinitionEndpointConfigure(edit: Record<string, unknown>): EditMutation {
  const datatype = edit.kind === "field-datatype-configure";
  const cardinality = edit.kind === "field-cardinality-configure";
  exactKeys(edit, [
    "kind",
    "fieldDefinitionId",
    "configurationNodeId",
    "configurationOccurrenceId",
    datatype ? "datatypeNodeId" : cardinality ? "cardinalityNodeId" : "optionalityNodeId",
    "valueOccurrenceId",
    ...(datatype ? ["optionsSupertagId", "optionsSupertagOccurrenceId"] : []),
  ]);
  const common = {
    fieldDefinitionId: nonemptyString(edit.fieldDefinitionId, "Field Definition identity"),
    configurationNodeId: nonemptyString(edit.configurationNodeId, "Field configuration Node identity"),
    configurationOccurrenceId: nonemptyString(
      edit.configurationOccurrenceId,
      "Field configuration Occurrence identity",
    ),
    valueOccurrenceId: nonemptyString(edit.valueOccurrenceId, "Field configuration endpoint Occurrence identity"),
  };
  if (datatype) {
    const datatypeNodeId = nonemptyString(edit.datatypeNodeId, "Field Datatype endpoint Node identity");
    return {
      kind: "field-datatype-configure",
      ...common,
      datatypeNodeId,
      ...optionsSupertagInput(edit, datatypeNodeId),
    };
  }
  if (cardinality) {
    return {
      kind: "field-cardinality-configure",
      ...common,
      cardinalityNodeId: nonemptyString(edit.cardinalityNodeId, "Field Cardinality endpoint Node identity"),
    };
  }
  return {
    kind: "field-optionality-configure",
    ...common,
    optionalityNodeId: nonemptyString(edit.optionalityNodeId, "Field Optionality endpoint Node identity"),
  };
}

function optionsSupertagInput(
  edit: Record<string, unknown>,
  datatypeNodeId: string,
): Readonly<{ optionsSupertagId?: string; optionsSupertagOccurrenceId?: string }> {
  const configured = datatypeNodeId === FIELD_DATATYPE_NODE_IDS.optionsFromSupertag;
  if (!configured) {
    if (edit.optionsSupertagId !== undefined || edit.optionsSupertagOccurrenceId !== undefined) {
      throw new Error("Only Options from Supertag accepts a source Supertag");
    }
    return {};
  }
  return {
    optionsSupertagId: nonemptyString(edit.optionsSupertagId, "Options source Supertag identity"),
    optionsSupertagOccurrenceId: nonemptyString(
      edit.optionsSupertagOccurrenceId,
      "Options source Supertag Occurrence identity",
    ),
  };
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
