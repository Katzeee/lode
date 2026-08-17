import type { DebugNodeResult } from "./contract.js";
import { fromProjectedNode, toProjectedNode } from "./protocol-projection-codec.js";
import { fromProtocolValue, toProtocolValue } from "./protocol-shape-codec.js";

export function toDebugNodeResult(value: DebugNodeResult): Record<string, unknown> {
  return {
    ...(toProtocolValue(value) as Record<string, unknown>),
    node: value.node === null ? null : toProjectedNode(value.node),
  };
}

export function fromDebugNodeResult(value: unknown): DebugNodeResult {
  const result = fromProtocolValue(value) as Record<string, unknown>;
  result.node = result.node === null ? null : fromProjectedNode(result.node);
  return result as DebugNodeResult;
}
