import type { MutableOccurrence } from "./projection-state.js";

export type TupleEndpoint = Readonly<{
  occurrenceId: string;
  nodeId: string;
  isOwning: boolean;
}>;

export type Tuple = Readonly<{
  nodeId: string;
  ownerNodeId: string | null | undefined;
  endpoints: readonly TupleEndpoint[];
}>;

export function projectTuple(
  nodeId: string,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  nodeOwners: Readonly<Record<string, string | null>> = {},
): Tuple {
  return {
    nodeId,
    ownerNodeId: nodeOwners[nodeId],
    endpoints: (childOccurrences.get(nodeId) ?? []).flatMap((occurrenceId) => {
      const occurrence = occurrences.get(occurrenceId);
      return occurrence?.parentNodeId === nodeId
        ? [{ occurrenceId, nodeId: occurrence.nodeId, isOwning: nodeOwners[occurrence.nodeId] === nodeId }]
        : [];
    }),
  };
}
