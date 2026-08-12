import type { FactFrontier } from "../domain/fact/index.js";
import type { ViewFieldCell, ViewResult, ViewRow } from "../domain/view/index.js";
import {
  array,
  enumValue,
  exact,
  nonempty,
  nullableString,
  object,
  stringArray,
  stringValue,
} from "./projection-page-validation-primitives.js";

export function parseViewResult(
  value: Record<string, unknown>,
  parseFrontier: (value: unknown) => FactFrontier,
): ViewResult {
  exact(
    value,
    [
      "generationId",
      "frontier",
      "view",
      "viewNodeId",
      "schemaId",
      "layout",
      "fieldDefinitionIds",
      "rows",
      "next",
    ],
    "View result",
  );
  return {
    generationId: nonempty(value.generationId, "View generation"),
    frontier: parseFrontier(value.frontier),
    view: enumValue(value.view, ["origin", "review"] as const, "View projection mode"),
    viewNodeId: nonempty(value.viewNodeId, "View Node identity"),
    schemaId: nonempty(value.schemaId, "View Schema identity"),
    layout: enumValue(value.layout, ["table", "cards", "calendar"] as const, "View layout"),
    fieldDefinitionIds: stringArray(value.fieldDefinitionIds),
    rows: array(value.rows, "View rows", parseViewRow),
    next: nullableString(value.next, "View cursor"),
  };
}

function parseViewRow(value: unknown): ViewRow {
  const row = object(value, "View row");
  exact(row, ["nodeId", "text", "fields"], "View row");
  return {
    nodeId: nonempty(row.nodeId, "View row Node"),
    text: stringValue(row.text, "View row text"),
    fields: array(row.fields, "View cells", parseViewCell),
  };
}

function parseViewCell(value: unknown): ViewFieldCell {
  const cell = object(value, "View cell");
  exact(
    cell,
    [
      "fieldDefinitionId",
      "state",
      "fieldNodeId",
      "fieldOccurrenceId",
      "valueOccurrenceIds",
      "valueNodeIds",
    ],
    "View cell",
  );
  return {
    fieldDefinitionId: nonempty(cell.fieldDefinitionId, "View Field Definition"),
    state: enumValue(
      cell.state,
      ["absent", "placeholder", "materialized"] as const,
      "View cell state",
    ),
    fieldNodeId: nullableString(cell.fieldNodeId, "View Field Node"),
    fieldOccurrenceId: nullableString(cell.fieldOccurrenceId, "View Field Occurrence"),
    valueOccurrenceIds: stringArray(cell.valueOccurrenceIds),
    valueNodeIds: stringArray(cell.valueNodeIds),
  };
}
