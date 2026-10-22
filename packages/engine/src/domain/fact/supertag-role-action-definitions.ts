import { identity } from "./action-contribution-helpers.js";
import { SELF_FACT_ACTION } from "./action-contribution-types.js";
import { defineAction, defineActionFamily } from "./action-definition.js";
import { factActionIdField, nonemptyStringField } from "./action-field-decoders.js";

export const supertagRoleActionDefinitions = defineActionFamily({
  add: defineAction("supertag-role-add", "proposable", "internal", { nodeId: nonemptyStringField }, (action) => [
    identity({ kind: "node", nodeId: action.nodeId }, "require", "relate", "contribution-owner"),
    identity(
      { kind: "intrinsic-node-type", nodeId: action.nodeId, intrinsicNodeType: "supertag-definition" },
      "declare",
    ),
    {
      kind: "causal-collection",
      collection: "supertag-role",
      operation: "add",
      key: SELF_FACT_ACTION,
      entryId: SELF_FACT_ACTION,
    },
  ]),
  remove: defineAction(
    "supertag-role-remove",
    "proposable",
    "internal",
    { nodeId: nonemptyStringField, roleActionId: factActionIdField },
    (action) => [
      identity({ kind: "node", nodeId: action.nodeId }, "require", "relate", "contribution-owner"),
      identity({ kind: "fact-action", factActionId: action.roleActionId }, "require"),
      {
        kind: "causal-collection",
        collection: "supertag-role",
        operation: "remove-observed",
        key: action.roleActionId,
      },
    ],
  ),
  restore: defineAction(
    "supertag-role-restore",
    "proposable",
    "internal",
    { nodeId: nonemptyStringField, roleActionId: factActionIdField },
    (action) => [
      identity({ kind: "node", nodeId: action.nodeId }, "require", "relate", "contribution-owner"),
      identity({ kind: "fact-action", factActionId: action.roleActionId }, "require"),
      { kind: "causal-collection", collection: "supertag-role", operation: "restore", entryId: action.roleActionId },
    ],
  ),
});
