import { nonempty, ShapeValidationError } from "../../decoding/index.js";
import { isIntrinsicNodeType, parseAuthoredAction, type GraphAction, type IntrinsicNodeType } from "../fact/index.js";
import {
  defineEdit,
  defineEditFamily,
  defineEditWithCustomParse,
  editField,
  optionalEditField,
  type DecodedEdit,
} from "./edit-definition.js";
import { nodeSeedField, nonemptyStringField, sequenceAnchorField } from "./edit-field-decoders.js";

const intrinsicNodeTypeField = editField<IntrinsicNodeType>(
  "Intrinsic Node Type",
  { kind: "enum", enum: "IntrinsicNodeType" },
  (value) => {
    if (!isIntrinsicNodeType(value)) {
      throw new ShapeValidationError("Intrinsic Node Type is invalid");
    }
    return value;
  },
);

const nodeCreateFields = {
  nodeId: nonemptyStringField("Created Node identity"),
  occurrenceId: nonemptyStringField("Original Occurrence identity"),
  parentNodeId: nonemptyStringField("Created Node parent identity"),
  anchor: sequenceAnchorField,
  seed: optionalEditField(nodeSeedField),
  intrinsicNodeType: optionalEditField(intrinsicNodeTypeField),
} as const;

const nodeRestoreFields = {
  nodeId: nonemptyStringField("Restore target Node identity"),
  occurrenceId: nonemptyStringField("Restored Occurrence identity"),
  parentNodeId: nonemptyStringField("Restored Occurrence parent identity"),
  anchor: sequenceAnchorField,
} as const;

const occurrencePlacementFields = {
  occurrenceId: nonemptyStringField("Occurrence identity"),
  nodeId: nonemptyStringField("Occurrence Node identity"),
  parentNodeId: nonemptyStringField("Occurrence parent identity"),
  anchor: sequenceAnchorField,
} as const;

const occurrenceMoveFields = {
  occurrenceId: nonemptyStringField("Occurrence identity"),
  parentNodeId: nonemptyStringField("Occurrence parent identity"),
  anchor: sequenceAnchorField,
} as const;

export const structuralEditDefinitions = defineEditFamily({
  createNode: defineEditWithCustomParse("node-create", nodeCreateFields, (edit) => {
    const identity = parseAuthoredAction({
      kind: "node-create",
      nodeId: edit.nodeId,
      ownerNodeId: edit.parentNodeId,
      originalPlacement: { placementId: edit.occurrenceId, anchor: edit.anchor },
      ...(edit.intrinsicNodeType === undefined ? {} : { intrinsicNodeType: edit.intrinsicNodeType }),
      ...(edit.seed === undefined ? {} : { seed: edit.seed }),
    });
    if (identity.originalPlacement === null) {
      throw new ShapeValidationError("Created Node requires an Original Placement");
    }
    return {
      kind: "node-create",
      nodeId: identity.nodeId,
      occurrenceId: identity.originalPlacement.placementId,
      parentNodeId: identity.ownerNodeId,
      anchor: identity.originalPlacement.anchor,
      ...(identity.intrinsicNodeType === undefined ? {} : { intrinsicNodeType: identity.intrinsicNodeType }),
      ...(identity.seed === undefined ? {} : { seed: identity.seed }),
    };
  }),
  deleteNode: defineEdit(
    "node-delete",
    { nodeId: nonemptyStringField("Delete target Node identity") },
    { plan: (edit) => [{ kind: "node-trash", nodeId: edit.nodeId }] },
  ),
  restoreNode: defineEditWithCustomParse(
    "node-restore",
    nodeRestoreFields,
    (edit) => {
      const placement = parseAuthoredAction({
        kind: "placement-move",
        placementId: edit.occurrenceId,
        parentNodeId: edit.parentNodeId,
        anchor: edit.anchor,
      });
      return {
        kind: "node-restore",
        nodeId: nonempty(edit.nodeId, "Restore target Node identity"),
        occurrenceId: placement.placementId,
        parentNodeId: placement.parentNodeId,
        anchor: placement.anchor,
      };
    },
    (edit) => [
      {
        kind: "node-restore",
        nodeId: edit.nodeId,
        placementId: edit.occurrenceId,
        parentNodeId: edit.parentNodeId,
        anchor: edit.anchor,
      },
    ],
  ),
  promoteReference: defineEdit("reference-promote", {
    occurrenceId: nonemptyStringField("Reference Occurrence identity"),
  }),
  createOccurrence: defineEditWithCustomParse(
    "occurrence-create",
    occurrencePlacementFields,
    occurrencePlacementParse("occurrence-create"),
    occurrencePlacementPlan,
  ),
  deleteOccurrence: defineEdit(
    "occurrence-delete",
    { occurrenceId: nonemptyStringField("Occurrence identity") },
    { plan: (edit) => [{ kind: "placement-remove", placementId: edit.occurrenceId }] },
  ),
  restoreOccurrence: defineEditWithCustomParse(
    "occurrence-restore",
    occurrencePlacementFields,
    occurrencePlacementParse("occurrence-restore"),
    occurrencePlacementPlan,
  ),
  moveOccurrence: defineEditWithCustomParse("occurrence-move", occurrenceMoveFields, (edit) => {
    const placement = parseAuthoredAction({
      kind: "placement-move",
      placementId: edit.occurrenceId,
      parentNodeId: edit.parentNodeId,
      anchor: edit.anchor,
    });
    return {
      kind: "occurrence-move",
      occurrenceId: placement.placementId,
      parentNodeId: placement.parentNodeId,
      anchor: placement.anchor,
    };
  }),
  createInlineReferenceAlias: defineEdit(
    "inline-reference-alias-create",
    {
      inlineReferenceId: nonemptyStringField("Inline Reference identity"),
      hostNodeId: nonemptyStringField("Inline Reference host Node identity"),
      aliasNodeId: nonemptyStringField("Inline Alias Node identity"),
      seed: optionalEditField(nodeSeedField),
    },
    {
      plan: (edit) => [
        {
          kind: "node-create",
          nodeId: edit.aliasNodeId,
          ownerNodeId: edit.hostNodeId,
          originalPlacement: null,
          ...(edit.seed === undefined ? {} : { seed: edit.seed }),
        },
        {
          kind: "inline-alias-attach",
          inlineReferenceId: edit.inlineReferenceId,
          aliasNodeId: edit.aliasNodeId,
        },
      ],
    },
  ),
});

function occurrencePlacementPlan(
  edit: DecodedEdit<"occurrence-create" | "occurrence-restore", typeof occurrencePlacementFields>,
): readonly [GraphAction] {
  return [
    {
      kind: "placement-create",
      placementId: edit.occurrenceId,
      nodeId: edit.nodeId,
      parentNodeId: edit.parentNodeId,
      anchor: edit.anchor,
    },
  ];
}

function occurrencePlacementParse<Kind extends "occurrence-create" | "occurrence-restore">(kind: Kind) {
  return (edit: Readonly<Record<string, unknown>>): DecodedEdit<Kind, typeof occurrencePlacementFields> => {
    const placement = parseAuthoredAction({
      kind: "placement-create",
      placementId: edit.occurrenceId,
      nodeId: edit.nodeId,
      parentNodeId: edit.parentNodeId,
      anchor: edit.anchor,
    });
    return {
      kind,
      occurrenceId: placement.placementId,
      nodeId: placement.nodeId,
      parentNodeId: placement.parentNodeId,
      anchor: placement.anchor,
    };
  };
}
