import type { NodeRestoreDestination as ProtocolDestination } from "@lode/protocol/proto";
import type { NodeRestoreDestination } from "./node-restore-destination.js";
import type { ProtocolDto } from "./protocol-dto.js";
import { required, selectedCase, unsupportedProtocolCase } from "./protocol-decoding.js";
import { ProtocolInputEncodingError } from "./protocol-input-error.js";

export function toNodeRestoreDestination(destination: NodeRestoreDestination): Record<string, unknown> {
  switch (destination.kind) {
    case "node":
      return { target: { case: "nodeId", value: destination.nodeId } };
    case "field":
      return {
        target: {
          case: "field",
          value: { ownerNodeId: destination.ownerNodeId, fieldDefinitionId: destination.fieldDefinitionId },
        },
      };
    default:
      destination satisfies never;
      throw new ProtocolInputEncodingError("Unsupported Node restoration destination");
  }
}

export function fromNodeRestoreDestination(input: unknown): NodeRestoreDestination {
  const destination = required(input as ProtocolDto<ProtocolDestination> | null, "Node restoration destination");
  const target = selectedCase(destination.target, "Node restoration destination");
  switch (target.case) {
    case "nodeId":
      return { kind: "node", nodeId: target.value };
    case "field":
      return { kind: "field", ...target.value };
    default:
      return unsupportedProtocolCase(target, "Node restoration destination");
  }
}
