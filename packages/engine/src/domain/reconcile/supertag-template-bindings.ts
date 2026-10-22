import { FIELD_INTRINSIC_NODE_TYPE } from "../fact/index.js";
import type { MutableOccurrence } from "./projection-state.js";

/** A Definition's authored content supplies its ordinary template sources. */
export function boundSupertagTemplateNodes(
  definitionIds: ReadonlySet<string>,
  nodes: Readonly<Record<string, Readonly<{ intrinsicNodeType: string | null }>>>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    [...definitionIds].flatMap((definitionId) => {
      const sources = (childOccurrences.get(definitionId) ?? []).flatMap((id) => {
        const occurrence = occurrences.get(id);
        const node = occurrence === undefined ? undefined : nodes[occurrence.nodeId];
        return occurrence?.parentNodeId === definitionId && node && node.intrinsicNodeType !== FIELD_INTRINSIC_NODE_TYPE
          ? [occurrence.nodeId]
          : [];
      });
      return sources.length === 0 ? [] : [[definitionId, [...new Set(sources)]]];
    }),
  );
}
