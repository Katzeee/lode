import { exact, nonempty, object } from "../../shape-validation/index.js";
import type { FieldDefinitionConfiguration } from "./projection-types.js";

export function parseFieldDefinitionConfiguration(value: unknown): FieldDefinitionConfiguration {
  const item = object(value, "Field Definition configuration");
  const base = {
    configurationNodeId: nonempty(item.configurationNodeId, "Field configuration Node identity"),
    configurationOccurrenceId: nonempty(item.configurationOccurrenceId, "Field configuration Occurrence identity"),
    contributionId: nonempty(item.contributionId, "Field configuration Contribution identity"),
  };
  if (item.kind === "datatype") {
    exact(
      item,
      ["kind", "configurationNodeId", "configurationOccurrenceId", "datatype", "contributionId"],
      "Field Datatype configuration",
    );
    if (item.datatype !== "plain" && item.datatype !== "options") {
      throw new Error("Field Datatype is invalid");
    }
    return { ...base, kind: "datatype", datatype: item.datatype };
  }
  if (item.kind === "cardinality") {
    exact(
      item,
      ["kind", "configurationNodeId", "configurationOccurrenceId", "cardinality", "contributionId"],
      "Field Cardinality configuration",
    );
    if (item.cardinality !== "single" && item.cardinality !== "list") {
      throw new Error("Field Cardinality is invalid");
    }
    return { ...base, kind: "cardinality", cardinality: item.cardinality };
  }
  if (item.kind !== "initialization-expression") {
    throw new Error("Field Definition configuration kind is invalid");
  }
  exact(
    item,
    ["kind", "configurationNodeId", "configurationOccurrenceId", "expression", "contributionId"],
    "Field Initialization Expression configuration",
  );
  const expression = object(item.expression, "Field Initialization Expression");
  exact(expression, ["kind", "sourceFieldDefinitionId"], "Field Initialization Expression");
  if (expression.kind !== "ancestor-field-values") {
    throw new Error("Field Initialization Expression kind is invalid");
  }
  return {
    ...base,
    kind: "initialization-expression",
    expression: {
      kind: "ancestor-field-values",
      sourceFieldDefinitionId: nonempty(
        expression.sourceFieldDefinitionId,
        "initialization source Field Definition identity",
      ),
    },
  };
}
