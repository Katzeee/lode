import { defineEdit, defineEditFamily } from "./edit-definition.js";
import { nonemptyStringField } from "./edit-field-decoders.js";

export const supertagRoleEditDefinitions = defineEditFamily({
  convert: defineEdit(
    "node-convert-to-supertag",
    { nodeId: nonemptyStringField("Existing ordinary Node identity") },
    {
      plan: (edit) => [{ kind: "supertag-role-add", nodeId: edit.nodeId }],
    },
  ),
});
