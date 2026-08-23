import { stableStringCompare, type FactAction } from "../fact/index.js";
import { metanodeHostNodeId, metanodeNodeId } from "./projection-identity.js";

export type Metanodes = Readonly<Record<string, string>>;

export function projectMetanodes(_active: readonly FactAction[], existingNodeIds: ReadonlySet<string>): Metanodes {
  return Object.fromEntries(
    [...existingNodeIds]
      .flatMap((nodeId) => {
        const hostNodeId = metanodeHostNodeId(nodeId);
        return hostNodeId !== null && existingNodeIds.has(hostNodeId) ? [hostNodeId] : [];
      })
      .sort(stableStringCompare)
      .map((hostNodeId) => [hostNodeId, metanodeNodeId(hostNodeId)]),
  );
}
