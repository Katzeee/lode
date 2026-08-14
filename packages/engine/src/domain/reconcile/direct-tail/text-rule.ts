import type { TextMutation } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplyTextDirectTail(projection: Projection, mutation: TextMutation): boolean {
  return projection.nodes[mutation.nodeId] !== undefined;
}
