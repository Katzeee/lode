import { parseAuthoredAction } from "../fact/index.js";
import { exactInputKeys, nonemptyInputString, optionalNodeSeed } from "./input-validation-primitives.js";
import type { EditAction } from "./types.js";

export function parseFieldValueCreate(edit: Record<string, unknown>): EditAction {
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
  const seed = optionalNodeSeed(edit.seed);
  const placement = parseAuthoredAction({
    kind: "placement-create",
    placementId: edit.valueOccurrenceId,
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
    valueOccurrenceId: placement.placementId,
    anchor: placement.anchor,
    ...(seed === undefined ? {} : { seed }),
  };
}

export function parseUrlNodeCreate(edit: Record<string, unknown>): EditAction {
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
  const seed = optionalNodeSeed(edit.seed);
  const placement = parseAuthoredAction({
    kind: "placement-create",
    placementId: edit.occurrenceId,
    nodeId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
  const url = nonemptyInputString(edit.url, "URL");
  assertAbsoluteUrl(url);
  return {
    kind: "url-node-create",
    nodeId,
    occurrenceId: placement.placementId,
    parentNodeId: placement.parentNodeId,
    anchor: placement.anchor,
    ...(seed === undefined ? {} : { seed }),
    urlFieldNodeId: nonemptyInputString(edit.urlFieldNodeId, "URL Field Node identity"),
    urlFieldOccurrenceId: nonemptyInputString(edit.urlFieldOccurrenceId, "URL Field Occurrence identity"),
    urlValueNodeId: nonemptyInputString(edit.urlValueNodeId, "URL Value Node identity"),
    urlValueOccurrenceId: nonemptyInputString(edit.urlValueOccurrenceId, "URL Value Occurrence identity"),
    url,
  };
}

export function parseCodeNodeConfigure(edit: Record<string, unknown>): EditAction {
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

function assertAbsoluteUrl(value: string): void {
  try {
    const url = new URL(value);
    if (!url.protocol || !url.hostname) {
      throw new Error("URL has no protocol or host");
    }
  } catch {
    throw new Error("URL must be absolute");
  }
}
