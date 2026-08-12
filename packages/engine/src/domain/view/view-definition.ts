import type { JsonValue } from "../fact/index.js";
import {
  MAX_VIEW_FIELDS,
  VIEW_FIELDS_PROPERTY,
  VIEW_LAYOUT_PROPERTY,
  VIEW_SCHEMA_PROPERTY,
  type ViewDefinition,
  type ViewLayout,
} from "./types.js";

export function readViewDefinition(
  node: Readonly<{ properties: Readonly<Record<string, JsonValue>> }>,
): ViewDefinition {
  const schemaId = node.properties[VIEW_SCHEMA_PROPERTY];
  const layout = node.properties[VIEW_LAYOUT_PROPERTY];
  const fields = node.properties[VIEW_FIELDS_PROPERTY];
  if (typeof schemaId !== "string" || schemaId.length === 0) {
    throw new Error("View Node has no Schema identity");
  }
  if (!isViewLayout(layout)) {
    throw new Error("View Node has an invalid layout");
  }
  if (
    !Array.isArray(fields) ||
    fields.length > MAX_VIEW_FIELDS ||
    fields.some((fieldId) => typeof fieldId !== "string" || fieldId.length === 0) ||
    new Set(fields).size !== fields.length
  ) {
    throw new Error(`View Node must select at most ${MAX_VIEW_FIELDS} unique Field Definitions`);
  }
  return { schemaId, layout, fieldDefinitionIds: fields as string[] };
}

function isViewLayout(value: unknown): value is ViewLayout {
  return value === "table" || value === "cards" || value === "calendar";
}
