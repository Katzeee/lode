import type { TextAction } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplyTextDirectTail(projection: Projection, action: TextAction): boolean {
  return projection.nodes[action.nodeId] !== undefined;
}
