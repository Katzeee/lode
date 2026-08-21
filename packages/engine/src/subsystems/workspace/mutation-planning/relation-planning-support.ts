import { atomicMutationWrite, type MutationWrite } from "../../../domain/edit/index.js";
import type { Mutation } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

export function prepareMetanodeCreation(
  hostNodeId: string,
  metanodeId: string,
  available: ScopedProjection,
  relationName: string,
): readonly Mutation[] {
  const existing = available.metanodes[hostNodeId];
  if (existing !== undefined && existing !== metanodeId) {
    throw new Error(`${relationName} Metanode identity does not match the host`);
  }
  return existing === undefined
    ? [
        { kind: "node-create", nodeId: metanodeId },
        { kind: "node-owner-set", nodeId: metanodeId, ownerNodeId: hostNodeId, previousOwnerNodeId: null },
        { kind: "metanode-attach", hostNodeId, metanodeId },
      ]
    : [];
}

export function endpoint(occurrenceId: string, nodeId: string, parentNodeId: string): Mutation {
  return {
    kind: "occurrence-create",
    occurrenceId,
    nodeId,
    parentNodeId,
    anchor: { after: null, before: null, affinity: "after", fallback: "end" },
  };
}

export function nonemptyAtomicWrite(mutations: readonly Mutation[], relationName: string): MutationWrite {
  const first = mutations[0];
  if (!first) {
    throw new Error(`${relationName} creation contains no mutations`);
  }
  return atomicMutationWrite([first, ...mutations.slice(1)]);
}
