import { ShapeValidationError } from "../../decoding/index.js";
import { parseAuthoredAction } from "../fact/index.js";
import { registryEditDefinition } from "./edit-catalog.js";
import { isDirectAuthoredActionEdit, type EditAction } from "./types.js";

export function parseEditAction(value: unknown): EditAction {
  const edit = inputObject(value);
  const definition = registryEditDefinition(edit.kind);
  if (definition !== undefined) {
    return definition.parse(edit);
  }
  return parseDirectAuthoredActionEdit(edit);
}

function parseDirectAuthoredActionEdit(edit: Record<string, unknown>): EditAction {
  const parsed = parseAuthoredAction(edit);
  if (!isDirectAuthoredActionEdit(parsed)) {
    throw new ShapeValidationError(`${parsed.kind} is not a public edit operation`);
  }
  return parsed;
}

function inputObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ShapeValidationError("Edit action must be an object");
  }
  return value as Record<string, unknown>;
}
