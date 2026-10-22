import type { NodeEditIntent as ProtocolNodeEditIntent } from "@lode/protocol/proto";
import type { NodeEditIntent } from "./template-node-edit.js";
import type { ProtocolDto } from "./protocol-dto.js";
import { selectedCase, unsupportedProtocolCase } from "./protocol-decoding.js";
import { fromNodeContentInput, toNodeContentInput } from "./protocol-node-content-input-codec.js";

export function toNodeEditIntent(intent: NodeEditIntent): Record<string, unknown> {
  const { kind, ...value } = intent;
  if (kind === "set-content" || kind === "insert-node") {
    return {
      intent: {
        case: kind === "set-content" ? "setContent" : "insertNode",
        value: { ...value, content: toNodeContentInput(intent.content) },
      },
    };
  }
  return { intent: { case: kind === "add-supertag" ? "addSupertag" : "removeSupertag", value } };
}

export function fromNodeEditIntent(value: unknown): NodeEditIntent {
  const selected = selectedCase((value as ProtocolDto<ProtocolNodeEditIntent>).intent, "Node editing intent");
  switch (selected.case) {
    case "insertNode": {
      const placement = selected.value.placement;
      if (placement !== "before" && placement !== "after" && placement !== "child") {
        throw new Error("Invalid Node insertion placement");
      }
      return {
        kind: "insert-node",
        ...selected.value,
        placement,
        content: fromNodeContentInput(selected.value.content),
      };
    }
    case "setContent":
      return { kind: "set-content", content: fromNodeContentInput(selected.value.content) };
    case "addSupertag":
      return { kind: "add-supertag", ...selected.value };
    case "removeSupertag":
      return { kind: "remove-supertag", ...selected.value };
    default:
      return unsupportedProtocolCase(selected, "Node editing intent");
  }
}
