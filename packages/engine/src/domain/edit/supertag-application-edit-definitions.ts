import { defineEdit, defineEditFamily } from "./edit-definition.js";
import { nonemptyStringField, sequenceAnchorField } from "./edit-field-decoders.js";

const hostNodeId = nonemptyStringField("Supertag Application host Node identity");
const supertagId = nonemptyStringField("Supertag Definition identity");

export const supertagApplicationEditDefinitions = defineEditFamily({
  create: defineEdit("supertag-application-create", { hostNodeId, supertagId, anchor: sequenceAnchorField }),
  remove: defineEdit(
    "supertag-remove",
    { hostNodeId, supertagId },
    {
      plan: (edit) => [
        { kind: "supertag-membership-remove", hostNodeId: edit.hostNodeId, supertagId: edit.supertagId },
      ],
    },
  ),
});
