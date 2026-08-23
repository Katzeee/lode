import { assertOneOf, requireString } from "../../decoding/index.js";
import { requireFactActionId } from "./identities.js";
import { parseSequenceAnchor } from "./serialized-shape.js";

export function assertViewActionShape(value: Record<string, unknown>): boolean {
  if (value.kind === "shared-default-view-add") {
    requireString(value.hostNodeId, "View host Node identity");
    assertOneOf(value.viewType, ["outline", "table"], "View type");
    parseSequenceAnchor(value.anchor);
  } else if (value.kind === "shared-default-view-remove") {
    requireString(value.hostNodeId, "View host Node identity");
  } else if (value.kind === "shared-default-view-restore" || value.kind === "view-mode-set") {
    requireFactActionId(value.viewId, "View identity");
    if (value.kind === "view-mode-set") {
      assertOneOf(value.viewType, ["outline", "table"], "View type");
    }
  } else if (value.kind === "view-column-add") {
    requireFactActionId(value.viewId, "View identity");
    requireString(value.fieldDefinitionId, "View Column Field Definition identity");
    parseSequenceAnchor(value.anchor);
  } else if (value.kind === "view-column-remove") {
    requireFactActionId(value.viewId, "View identity");
    requireString(value.fieldDefinitionId, "View Column Field Definition identity");
  } else if (value.kind === "view-column-move") {
    requireFactActionId(value.columnId, "View Column identity");
    parseSequenceAnchor(value.anchor);
  } else if (value.kind === "view-sort-add") {
    requireFactActionId(value.viewId, "View identity");
    assertSort(value);
  } else if (value.kind === "view-sort-configure") {
    requireFactActionId(value.sortId, "View Sort identity");
    assertSort(value);
  } else if (
    value.kind === "view-sort-remove" ||
    value.kind === "view-group-remove" ||
    value.kind === "view-filter-remove"
  ) {
    requireFactActionId(value.viewId, "View identity");
  } else if (value.kind === "view-sort-restore") {
    requireFactActionId(value.sortId, "View Sort identity");
  } else if (value.kind === "view-group-add") {
    requireFactActionId(value.viewId, "View identity");
    requireString(value.fieldDefinitionId, "View Group Field Definition identity");
  } else if (value.kind === "view-filter-add") {
    requireFactActionId(value.viewId, "View identity");
  } else if (value.kind === "view-filter-restore") {
    requireFactActionId(value.filterId, "View Filter identity");
  } else {
    return false;
  }
  return true;
}

function assertSort(value: Record<string, unknown>): void {
  requireString(value.fieldDefinitionId, "View Sort Field Definition identity");
  assertOneOf(value.direction, ["ascending", "descending"], "View Sort direction");
}
