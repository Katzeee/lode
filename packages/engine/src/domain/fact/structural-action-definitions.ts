import { exact, object, ShapeValidationError } from "../../decoding/index.js";
import { templateInstanceNodeId } from "./identity.js";
import { anchorIdentities, identity } from "./action-contribution-helpers.js";
import { defineAction, defineActionFamily, field, optionalField } from "./action-definition.js";
import { nonemptyStringField, sequenceAnchorField } from "./action-field-decoders.js";
import { isIntrinsicNodeType, type IntrinsicNodeType } from "./intrinsic-node-type-types.js";
import { parseNodeSeed } from "./node-create-shape.js";
import type { NodeSeed, OriginalPlacement } from "./node-create-types.js";

const originalPlacementField = field<OriginalPlacement>((value) => {
  const placement = object(value, "Original Placement");
  exact(placement, ["placementId", "anchor"], "Original Placement");
  const placementId = nonemptyStringField.parse(placement.placementId, "Original Placement identity");
  const anchor = sequenceAnchorField.parse(placement.anchor, "Original Placement anchor");
  return { placementId, anchor };
});

const nullableOriginalPlacementField = field<OriginalPlacement | null>((value, label) =>
  value === null ? null : originalPlacementField.parse(value, label),
);

const intrinsicNodeTypeField = field<IntrinsicNodeType>((value) => {
  if (!isIntrinsicNodeType(value)) {
    throw new ShapeValidationError("Intrinsic Node Type is invalid");
  }
  return value;
});

const nodeSeedField = field<NodeSeed>((value) => parseNodeSeed(value));

export const nodeActionDefinitions = defineActionFamily({
  workspaceBootstrap: defineAction(
    "workspace-bootstrap",
    "direct-only",
    "internal",
    {
      workspaceNodeId: nonemptyStringField,
    },
    (action) => [{ kind: "node-declaration", nodeId: action.workspaceNodeId }],
  ),
  create: defineAction(
    "node-create",
    "proposable",
    "composite",
    {
      nodeId: nonemptyStringField,
      ownerNodeId: nonemptyStringField,
      originalPlacement: nullableOriginalPlacementField,
      intrinsicNodeType: optionalField(intrinsicNodeTypeField),
      seed: optionalField(nodeSeedField),
    },
    (action) => [
      {
        kind: "node-declaration",
        nodeId: action.nodeId,
        ownerNodeId: action.ownerNodeId,
        ...(action.intrinsicNodeType === undefined ? {} : { intrinsicNodeType: action.intrinsicNodeType }),
      },
      ...(action.originalPlacement === null
        ? []
        : [
            {
              kind: "sequence-position" as const,
              operation: "insert" as const,
              occurrenceId: action.originalPlacement.placementId,
              nodeId: action.nodeId,
              parentNodeId: action.ownerNodeId,
              anchor: action.originalPlacement.anchor,
            },
          ]),
    ],
  ),
  trash: defineAction("node-trash", "proposable", "internal", { nodeId: nonemptyStringField }, (action) => [
    { kind: "node-lifecycle", operation: "trash", nodeId: action.nodeId },
  ]),
  restore: defineAction(
    "node-restore",
    "proposable",
    "composite",
    {
      nodeId: nonemptyStringField,
      placementId: nonemptyStringField,
      parentNodeId: nonemptyStringField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      {
        kind: "node-lifecycle",
        operation: "restore",
        nodeId: action.nodeId,
        occurrenceId: action.placementId,
        parentNodeId: action.parentNodeId,
        anchor: action.anchor,
      },
    ],
  ),
  finalizeDeletion: defineAction(
    "node-deletion-finalize",
    "terminal",
    "internal",
    { nodeId: nonemptyStringField },
    (action) => [{ kind: "terminal-cutoff", nodeId: action.nodeId }],
  ),
  promoteOriginal: defineAction(
    "original-promote",
    "proposable",
    "internal",
    {
      nodeId: nonemptyStringField,
      placementId: nonemptyStringField,
    },
    (action) => [
      {
        kind: "node-lifecycle",
        operation: "promote-original",
        nodeId: action.nodeId,
        occurrenceId: action.placementId,
      },
    ],
  ),
});

export const placementActionDefinitions = defineActionFamily({
  create: defineAction(
    "placement-create",
    "proposable",
    "internal",
    {
      placementId: nonemptyStringField,
      nodeId: nonemptyStringField,
      parentNodeId: nonemptyStringField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      {
        kind: "sequence-position",
        operation: "insert",
        occurrenceId: action.placementId,
        nodeId: action.nodeId,
        parentNodeId: action.parentNodeId,
        anchor: action.anchor,
      },
      identity({ kind: "node", nodeId: action.nodeId }, "contribution-owner"),
      identity({ kind: "node", nodeId: action.parentNodeId }, "contribution-owner"),
    ],
  ),
  remove: defineAction("placement-remove", "proposable", "internal", { placementId: nonemptyStringField }, (action) => [
    { kind: "sequence-position", operation: "remove", occurrenceId: action.placementId },
  ]),
  move: defineAction(
    "placement-move",
    "proposable",
    "internal",
    {
      placementId: nonemptyStringField,
      parentNodeId: nonemptyStringField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      {
        kind: "sequence-position",
        operation: "move",
        occurrenceId: action.placementId,
        parentNodeId: action.parentNodeId,
        anchor: action.anchor,
      },
      identity({ kind: "node", nodeId: action.parentNodeId }, "contribution-owner"),
    ],
  ),
});

export const templateActionDefinitions = defineActionFamily({
  detachNode: defineAction(
    "template-node-detach",
    "proposable",
    "direct",
    {
      ownerNodeId: nonemptyStringField,
      templateNodeId: nonemptyStringField,
      instanceNodeId: nonemptyStringField,
      instanceOccurrenceId: nonemptyStringField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      identity({ kind: "node", nodeId: action.ownerNodeId }, "relate", "require", "contribution-owner"),
      identity({ kind: "node", nodeId: action.templateNodeId }, "relate", "require"),
      identity({ kind: "node", nodeId: action.instanceNodeId }, "relate", "require", "contribution-owner"),
      identity({ kind: "node", nodeId: templateInstanceNodeId(action.ownerNodeId, action.templateNodeId) }, "relate"),
      { kind: "generated-occurrence", occurrenceId: action.instanceOccurrenceId },
      ...anchorIdentities(action.anchor),
    ],
  ),
});
