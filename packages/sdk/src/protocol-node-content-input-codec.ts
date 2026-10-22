import type { NodeContentInput as ProtocolNodeContentInput } from "@lode/protocol/proto";
import type { NodeContentInput } from "./template-node-edit.js";
import type { ProtocolDto } from "./protocol-dto.js";
import { required, selectedCase, unsupportedProtocolCase } from "./protocol-decoding.js";

export function toNodeContentInput(content: NodeContentInput): Record<string, unknown> {
  return {
    ...content,
    items: content.items.map((item) => {
      const { kind, ...value } = item;
      if (kind === "text") {
        return { content: { case: "text", value } };
      }
      const reference = item;
      return {
        content: {
          case: "inlineReference",
          value: { ...value, alias: reference.alias ? toNodeContentInput(reference.alias) : null },
        },
      };
    }),
  };
}

export function fromNodeContentInput(value: unknown): NodeContentInput {
  const content = required(value as ProtocolDto<ProtocolNodeContentInput> | null, "Node content input");
  return {
    items: content.items.map((item) => {
      const selected = selectedCase(item.content, "Node content item");
      switch (selected.case) {
        case "text":
          return { kind: "text", ...selected.value };
        case "inlineReference":
          return {
            kind: "inline-reference",
            targetNodeId: selected.value.targetNodeId,
            ...(selected.value.sourceReferenceId === null
              ? {}
              : { sourceReferenceId: selected.value.sourceReferenceId }),
            ...(selected.value.alias === null ? {} : { alias: fromNodeContentInput(selected.value.alias) }),
          };
        default:
          return unsupportedProtocolCase(selected, "Node content input");
      }
    }),
  };
}
