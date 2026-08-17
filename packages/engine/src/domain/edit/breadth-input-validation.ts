import { parseMutation } from "../fact/index.js";
import { exactInputKeys, nonemptyInputString } from "./input-validation-primitives.js";
import type { EditMutation } from "./types.js";

export function parseDebugNodeOpen(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, ["kind", "hostNodeId", "metanodeId"]);
  return {
    kind: "debug-node-open",
    hostNodeId: nonemptyInputString(edit.hostNodeId, "Debug node host identity"),
    metanodeId: nonemptyInputString(edit.metanodeId, "Debug node Metanode identity"),
  };
}

export function parseFieldValueCreate(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "ownerNodeId",
    "fieldDefinitionId",
    "fieldNodeId",
    "fieldOccurrenceId",
    "valueNodeId",
    "valueOccurrenceId",
    "anchor",
    "seed",
  ]);
  const valueNodeId = nonemptyInputString(edit.valueNodeId, "Field Value Node identity");
  const node = parseMutation({
    kind: "node-create",
    nodeId: valueNodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: edit.valueOccurrenceId,
    nodeId: valueNodeId,
    parentNodeId: edit.fieldNodeId,
    anchor: edit.anchor,
  });
  return {
    kind: "field-value-create",
    ownerNodeId: nonemptyInputString(edit.ownerNodeId, "Field owner Node identity"),
    fieldDefinitionId: nonemptyInputString(edit.fieldDefinitionId, "Field Definition identity"),
    fieldNodeId: placement.parentNodeId,
    fieldOccurrenceId: nonemptyInputString(edit.fieldOccurrenceId, "Field Occurrence identity"),
    valueNodeId,
    valueOccurrenceId: placement.occurrenceId,
    anchor: placement.anchor,
    ...(node.seed === undefined ? {} : { seed: node.seed }),
  };
}

export function parseUrlNodeCreate(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "nodeId",
    "occurrenceId",
    "parentNodeId",
    "anchor",
    "seed",
    "urlFieldNodeId",
    "urlFieldOccurrenceId",
    "urlValueNodeId",
    "urlValueOccurrenceId",
    "url",
  ]);
  const nodeId = nonemptyInputString(edit.nodeId, "URL Node identity");
  const node = parseMutation({
    kind: "node-create",
    nodeId,
    ...(edit.seed === undefined ? {} : { seed: edit.seed }),
  });
  const placement = parseMutation({
    kind: "occurrence-create",
    occurrenceId: edit.occurrenceId,
    nodeId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
  const url = nonemptyInputString(edit.url, "URL");
  assertAbsoluteUrl(url);
  return {
    kind: "url-node-create",
    nodeId,
    occurrenceId: placement.occurrenceId,
    parentNodeId: placement.parentNodeId,
    anchor: placement.anchor,
    ...(node.seed === undefined ? {} : { seed: node.seed }),
    urlFieldNodeId: nonemptyInputString(edit.urlFieldNodeId, "URL Field Node identity"),
    urlFieldOccurrenceId: nonemptyInputString(edit.urlFieldOccurrenceId, "URL Field Occurrence identity"),
    urlValueNodeId: nonemptyInputString(edit.urlValueNodeId, "URL Value Node identity"),
    urlValueOccurrenceId: nonemptyInputString(edit.urlValueOccurrenceId, "URL Value Occurrence identity"),
    url,
  };
}

export function parseCodeNodeConfigure(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "nodeId",
    "languageFieldNodeId",
    "languageFieldOccurrenceId",
    "languageValueNodeId",
    "languageValueOccurrenceId",
    "language",
  ]);
  return {
    kind: "code-node-configure",
    nodeId: nonemptyInputString(edit.nodeId, "Code Node identity"),
    languageFieldNodeId: nonemptyInputString(edit.languageFieldNodeId, "Code language Field Node identity"),
    languageFieldOccurrenceId: nonemptyInputString(
      edit.languageFieldOccurrenceId,
      "Code language Field Occurrence identity",
    ),
    languageValueNodeId: nonemptyInputString(edit.languageValueNodeId, "Code language Value Node identity"),
    languageValueOccurrenceId: nonemptyInputString(
      edit.languageValueOccurrenceId,
      "Code language Value Occurrence identity",
    ),
    language: nonemptyInputString(edit.language, "Code language"),
  };
}

export function parseSharedDefaultViewDefinitionSortByNameCreate(edit: Record<string, unknown>): EditMutation {
  exactInputKeys(edit, [
    "kind",
    "hostNodeId",
    "viewDefinitionNodeId",
    "sortOrderFieldNodeId",
    "sortOrderFieldOccurrenceId",
    "sortFieldNodeId",
    "sortFieldOccurrenceId",
    "nodeNameOccurrenceId",
    "ascendingOccurrenceId",
  ]);
  return {
    kind: "shared-default-view-definition-sort-by-name-create",
    hostNodeId: nonemptyInputString(edit.hostNodeId, "View host Node identity"),
    viewDefinitionNodeId: nonemptyInputString(edit.viewDefinitionNodeId, "View Definition Node identity"),
    sortOrderFieldNodeId: nonemptyInputString(edit.sortOrderFieldNodeId, "Sort order Field Node identity"),
    sortOrderFieldOccurrenceId: nonemptyInputString(
      edit.sortOrderFieldOccurrenceId,
      "Sort order Field Occurrence identity",
    ),
    sortFieldNodeId: nonemptyInputString(edit.sortFieldNodeId, "Sort field Node identity"),
    sortFieldOccurrenceId: nonemptyInputString(edit.sortFieldOccurrenceId, "Sort field Occurrence identity"),
    nodeNameOccurrenceId: nonemptyInputString(edit.nodeNameOccurrenceId, "Node name Occurrence identity"),
    ascendingOccurrenceId: nonemptyInputString(edit.ascendingOccurrenceId, "ASC Occurrence identity"),
  };
}

function assertAbsoluteUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("URL must be absolute");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL protocol must be HTTP or HTTPS");
  }
}
