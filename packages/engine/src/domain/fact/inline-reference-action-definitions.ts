import { defineAction, defineActionFamily } from "./action-definition.js";
import { identity } from "./action-semantics/contribution-helpers.js";
import { nonemptyStringField, sequenceAnchorField } from "./action-field-decoders.js";

export const inlineReferenceActionDefinitions = defineActionFamily({
  create: defineAction(
    "inline-reference-create",
    "proposable",
    {
      inlineReferenceId: nonemptyStringField,
      hostNodeId: nonemptyStringField,
      targetNodeId: nonemptyStringField,
      anchor: sequenceAnchorField,
    },
    (action) => [
      identity({ kind: "inline-reference", inlineReferenceId: action.inlineReferenceId }, "relate", "declare"),
      identity({ kind: "node", nodeId: action.hostNodeId }, "relate", "require", "contribution-owner"),
      identity({ kind: "node", nodeId: action.targetNodeId }, "relate", "require"),
    ],
  ),
  remove: defineAction(
    "inline-reference-remove",
    "proposable",
    {
      inlineReferenceId: nonemptyStringField,
    },
    (action) => [
      identity({ kind: "inline-reference", inlineReferenceId: action.inlineReferenceId }, "relate", "require"),
    ],
  ),
  attachAlias: defineAction(
    "inline-alias-attach",
    "proposable",
    {
      inlineReferenceId: nonemptyStringField,
      aliasNodeId: nonemptyStringField,
    },
    (action) => [
      identity({ kind: "inline-reference", inlineReferenceId: action.inlineReferenceId }, "relate", "require"),
      identity(
        { kind: "inline-alias", inlineReferenceId: action.inlineReferenceId, aliasNodeId: action.aliasNodeId },
        "declare",
      ),
      identity({ kind: "node", nodeId: action.aliasNodeId }, "relate", "require", "contribution-owner"),
    ],
  ),
  detachAlias: defineAction(
    "inline-alias-detach",
    "proposable",
    {
      inlineReferenceId: nonemptyStringField,
      aliasNodeId: nonemptyStringField,
    },
    (action) => [
      identity({ kind: "inline-reference", inlineReferenceId: action.inlineReferenceId }, "relate", "require"),
      identity(
        { kind: "inline-alias", inlineReferenceId: action.inlineReferenceId, aliasNodeId: action.aliasNodeId },
        "require",
      ),
      identity({ kind: "node", nodeId: action.aliasNodeId }, "relate", "contribution-owner"),
    ],
  ),
});
