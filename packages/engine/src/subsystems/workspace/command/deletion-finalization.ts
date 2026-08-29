import { stableStringCompare, terminalActionBody } from "../../../domain/fact/index.js";
import { nodeLocation } from "../../../domain/reconcile/index.js";
import type { AcceptedEngineCommand } from "../application/input-validation.js";
import { rejectedResult } from "../workspace-results.js";
import type { BoundWorkspaceCommand } from "./command-rule.js";

type FinalizeDeletionsCommand = Extract<AcceptedEngineCommand, { kind: "finalize-deletions" }>;

export function bindDeletionFinalizationCommand(command: FinalizeDeletionsCommand): BoundWorkspaceCommand {
  return {
    readPlan: {
      kind: "all",
    },
    plan({ generation }) {
      const invalid = command.nodeIds.find(
        (nodeId) => nodeLocation(generation.identity.workspaceNodeId, generation.origin, nodeId) !== "trash",
      );
      if (invalid !== undefined) {
        return rejectedResult(
          "invalid-input",
          `Deletion Finalization root is not in Trash: ${invalid}`,
          generation.identity.generationId,
        );
      }
      const roots = new Set(command.nodeIds);
      const targets = [...roots];
      for (const nodeId of Object.keys(generation.origin.nodeOwners)) {
        if (!roots.has(nodeId) && belongsToRoot(nodeId, roots, generation.origin.nodeOwners)) {
          targets.push(nodeId);
        }
      }
      targets.sort(stableStringCompare);
      const [first, ...rest] = targets;
      if (first === undefined) {
        throw new Error("Deletion Finalization requires a non-empty target set");
      }
      return {
        writes: [
          terminalActionBody(command.actorId, [
            { kind: "node-deletion-finalize", nodeId: first },
            ...rest.map((nodeId) => ({ kind: "node-deletion-finalize" as const, nodeId })),
          ]),
        ],
        lineage: null,
      };
    },
  };
}

function belongsToRoot(
  nodeId: string,
  roots: ReadonlySet<string>,
  nodeOwners: Readonly<Record<string, string | null>>,
): boolean {
  const visited = new Set<string>();
  let cursor = nodeOwners[nodeId];
  while (cursor !== null && cursor !== undefined && !visited.has(cursor)) {
    if (roots.has(cursor)) {
      return true;
    }
    visited.add(cursor);
    cursor = nodeOwners[cursor];
  }
  return false;
}
