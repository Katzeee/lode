import { array, exact, nonempty, object, ShapeValidationError } from "../../decoding/index.js";
import { editField } from "./edit-definition.js";
import { nodeContentInputField, type NodeContentInput } from "./node-content-input.js";

export type NodeEditIntent =
  | Readonly<{ kind: "set-content"; content: NodeContentInput }>
  | Readonly<{
      kind: "insert-node";
      nodeId: string;
      occurrenceId: string;
      placement: "before" | "after" | "child";
      content: NodeContentInput;
      supertagIds: readonly string[];
    }>
  | Readonly<{ kind: "add-supertag"; supertagId: string }>
  | Readonly<{ kind: "remove-supertag"; supertagId: string }>;

export const nodeEditIntentsField = editField<readonly NodeEditIntent[]>(
  "Node editing intents",
  { kind: "message-list", message: "NodeEditIntent" },
  (value) =>
    array(value, "Node editing intents", (value): NodeEditIntent => {
      const intent = object(value, "Node editing intent");
      if (intent.kind === "insert-node") {
        exact(
          intent,
          ["kind", "nodeId", "occurrenceId", "placement", "content", "supertagIds"],
          "Node insertion intent",
        );
        if (intent.placement !== "before" && intent.placement !== "after" && intent.placement !== "child") {
          throw new ShapeValidationError("Invalid Node insertion placement");
        }
        return {
          kind: "insert-node",
          nodeId: nonempty(intent.nodeId, "Inserted Node"),
          occurrenceId: nonempty(intent.occurrenceId, "Inserted Occurrence"),
          placement: intent.placement,
          content: nodeContentInputField.parse(intent.content, "Inserted content"),
          supertagIds: array(intent.supertagIds, "Inserted tags", (id) => nonempty(id, "Supertag Definition")),
        };
      }
      if (intent.kind === "set-content") {
        exact(intent, ["kind", "content"], "Content editing intent");
        return { kind: "set-content", content: nodeContentInputField.parse(intent.content, "Edited content") };
      }
      if (intent.kind === "add-supertag" || intent.kind === "remove-supertag") {
        exact(intent, ["kind", "supertagId"], "Supertag editing intent");
        return { kind: intent.kind, supertagId: nonempty(intent.supertagId, "Supertag Definition") };
      }
      throw new ShapeValidationError("Unsupported Node editing intent");
    }),
);
