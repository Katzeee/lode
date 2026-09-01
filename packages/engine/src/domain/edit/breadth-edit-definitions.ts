import { nonempty, ShapeValidationError } from "../../decoding/index.js";
import { materializedFieldNodeId, parseAuthoredAction, parseNodeSeed } from "../fact/index.js";
import { defineEdit, defineEditFamily, defineEditWithCustomParse, optionalEditField } from "./edit-definition.js";
import { nodeSeedField, nonemptyStringField, sequenceAnchorField } from "./edit-field-decoders.js";

const fieldValueCreateFields = {
  ownerNodeId: nonemptyStringField("Field owner Node identity"),
  fieldDefinitionId: nonemptyStringField("Field Definition identity"),
  valueNodeId: nonemptyStringField("Field Value Node identity"),
  valueOccurrenceId: nonemptyStringField("Field Value Occurrence identity"),
  anchor: sequenceAnchorField,
  seed: optionalEditField(nodeSeedField),
} as const;

const urlNodeCreateFields = {
  nodeId: nonemptyStringField("URL Node identity"),
  occurrenceId: nonemptyStringField("URL Node Occurrence identity"),
  parentNodeId: nonemptyStringField("URL Node parent identity"),
  anchor: sequenceAnchorField,
  seed: optionalEditField(nodeSeedField),
  urlValueNodeId: nonemptyStringField("URL Value Node identity"),
  urlValueOccurrenceId: nonemptyStringField("URL Value Occurrence identity"),
  url: nonemptyStringField("URL"),
} as const;

export const breadthEditDefinitions = defineEditFamily({
  createFieldValue: defineEditWithCustomParse("field-value-create", fieldValueCreateFields, (edit) => {
    const valueNodeId = nonempty(edit.valueNodeId, "Field Value Node identity");
    const ownerNodeId = nonempty(edit.ownerNodeId, "Field owner Node identity");
    const fieldDefinitionId = nonempty(edit.fieldDefinitionId, "Field Definition identity");
    const seed = edit.seed === undefined ? undefined : parseNodeSeed(edit.seed);
    const placement = parseAuthoredAction({
      kind: "placement-create",
      placementId: edit.valueOccurrenceId,
      nodeId: valueNodeId,
      parentNodeId: materializedFieldNodeId(ownerNodeId, fieldDefinitionId),
      anchor: edit.anchor,
    });
    return {
      kind: "field-value-create",
      ownerNodeId,
      fieldDefinitionId,
      valueNodeId,
      valueOccurrenceId: placement.placementId,
      anchor: placement.anchor,
      ...(seed === undefined ? {} : { seed }),
    };
  }),
  createUrlNode: defineEditWithCustomParse("url-node-create", urlNodeCreateFields, (edit) => {
    const nodeId = nonempty(edit.nodeId, "URL Node identity");
    const seed = edit.seed === undefined ? undefined : parseNodeSeed(edit.seed);
    const placement = parseAuthoredAction({
      kind: "placement-create",
      placementId: edit.occurrenceId,
      nodeId,
      parentNodeId: edit.parentNodeId,
      anchor: edit.anchor,
    });
    const url = nonempty(edit.url, "URL");
    assertAbsoluteUrl(url);
    return {
      kind: "url-node-create",
      nodeId,
      occurrenceId: placement.placementId,
      parentNodeId: placement.parentNodeId,
      anchor: placement.anchor,
      ...(seed === undefined ? {} : { seed }),
      urlValueNodeId: nonempty(edit.urlValueNodeId, "URL Value Node identity"),
      urlValueOccurrenceId: nonempty(edit.urlValueOccurrenceId, "URL Value Occurrence identity"),
      url,
    };
  }),
  configureCodeNode: defineEdit("code-node-configure", {
    nodeId: nonemptyStringField("Code Node identity"),
    languageValueNodeId: nonemptyStringField("Code language Value Node identity"),
    languageValueOccurrenceId: nonemptyStringField("Code language Value Occurrence identity"),
    language: nonemptyStringField("Code language"),
  }),
});

function assertAbsoluteUrl(value: string): void {
  try {
    const url = new URL(value);
    if (!url.protocol || !url.hostname) {
      throw new ShapeValidationError("URL has no protocol or host");
    }
  } catch {
    throw new ShapeValidationError("URL must be absolute");
  }
}
