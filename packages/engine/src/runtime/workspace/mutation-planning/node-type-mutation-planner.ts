import type { Mutation } from "../../../domain/fact/index.js";
import { assertNodeTypeCompatible } from "../../../domain/mutation-evidence/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

export function prepareNodeTypeMutation(
  mutation: Extract<Mutation, { kind: "node-type-declare" }>,
  available: ScopedProjection,
): Mutation {
  assertNodeTypeCompatible(mutation, available);
  const current = available.nodeStatuses[mutation.nodeId]?.nodeType ?? null;
  if (current === mutation.nodeType) {
    throw new Error("Node already has the requested type");
  }
  return mutation;
}
