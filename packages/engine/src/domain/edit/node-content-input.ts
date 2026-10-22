import { array, exact, nonempty, object, ShapeValidationError } from "../../decoding/index.js";
import { parseNodeSeed, type JsonValue } from "../fact/index.js";
import { editField } from "./edit-definition.js";

/** Initialization input compiled into ordinary content Facts; it is not stored content. */
export type NodeContentInput = Readonly<{ items: readonly NodeContentInputItem[] }>;
type NodeContentInputItem =
  | Readonly<{ kind: "text"; value: string; attributes: Readonly<Record<string, JsonValue>> }>
  | Readonly<{ kind: "inline-reference"; targetNodeId: string; sourceReferenceId?: string; alias?: NodeContentInput }>;

export const nodeContentInputField = editField<NodeContentInput>(
  "Initial edited Node content",
  { kind: "message", message: "NodeContentInput" },
  parseNodeContentInput,
);

function parseNodeContentInput(value: unknown): NodeContentInput {
  const content = object(value, "Node content input");
  exact(content, ["items"], "Node content input");
  return {
    items: array(content.items, "Node content items", (value): NodeContentInputItem => {
      const item = object(value, "Node content item");
      if (item.kind === "text") {
        exact(item, ["kind", "value", "attributes"], "Text input");
        const text = parseNodeSeed({ text: [{ value: item.value, attributes: item.attributes }] }).text[0];
        if (!text) {
          throw new ShapeValidationError("Text initialization is absent");
        }
        return { kind: "text", ...text };
      }
      if (item.kind === "inline-reference") {
        exact(
          item,
          [
            "kind",
            "targetNodeId",
            ...(item.alias === undefined ? [] : ["alias"]),
            ...(item.sourceReferenceId === undefined ? [] : ["sourceReferenceId"]),
          ],
          "Reference input",
        );
        return {
          kind: "inline-reference",
          targetNodeId: nonempty(item.targetNodeId, "Reference target"),
          ...(item.sourceReferenceId === undefined
            ? {}
            : { sourceReferenceId: nonempty(item.sourceReferenceId, "Retained source Reference") }),
          ...(item.alias === undefined ? {} : { alias: parseNodeContentInput(item.alias) }),
        };
      }
      throw new ShapeValidationError("Unsupported Node content input kind");
    }),
  };
}
