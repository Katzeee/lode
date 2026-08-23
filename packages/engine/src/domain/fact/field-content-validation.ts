import type { FieldContentRemovalAction } from "./types.js";
import { requireString } from "../../decoding/index.js";

export function assertFieldContentDeletionShape(
  value: Record<string, unknown>,
): asserts value is FieldContentRemovalAction {
  if (value.kind === "field-value-remove") {
    requireString(value.valuePlacementId, "Field Value Placement");
  } else {
    requireString(value.ownerNodeId, "Field owner Node");
    requireString(value.fieldDefinitionId, "Field Definition");
  }
}
