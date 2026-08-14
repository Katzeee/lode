import type { ValueMutation } from "../../fact/index.js";
import type { Projection } from "../projection-types.js";

export function canApplyValueDirectTail(projection: Projection, mutation: ValueMutation): boolean {
  return mutation.target.kind === "node"
    ? projection.nodes[mutation.target.id] !== undefined
    : projection.occurrences[mutation.target.id] !== undefined;
}
