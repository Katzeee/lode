import { array, nonempty } from "../../decoding/index.js";
import { defineEdit, defineEditFamily, editField } from "./edit-definition.js";
import { nonemptyStringField } from "./edit-field-decoders.js";
import { nodeEditIntentsField } from "./node-edit-intent.js";

export const templateNodeEditDefinitions = defineEditFamily({
  edit: defineEdit("template-node-edit", {
    ownerNodeId: nonemptyStringField("Template instance owner"),
    templateNodeId: nonemptyStringField("Root template source Node"),
    sourcePath: editField("Owned source occurrence path", { kind: "string-list" }, (value) =>
      array(value, "Source path", (item) => nonempty(item, "Source occurrence")),
    ),
    intents: nodeEditIntentsField,
  }),
});
