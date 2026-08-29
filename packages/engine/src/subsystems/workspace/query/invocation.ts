import type { InvocationOutcome, InvocationQuery } from "@lode/sdk";
import { frontierCovers } from "../../../domain/fact/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import type { WorkspaceProjectionState } from "../projection/index.js";
import { pendingResult, publishedResult } from "../workspace-results.js";

type InvocationFactReader = Pick<FactAuthorityPort, "receipt">;

export function queryWorkspaceInvocation(
  query: InvocationQuery,
  facts: InvocationFactReader,
  state: WorkspaceProjectionState,
  projectionFailure: string | null,
): InvocationOutcome {
  const identity = state.generation.identity;
  const receipt = facts.receipt(query.invocationId);
  const outcome = !receipt
    ? ({ status: "absent" } as const)
    : frontierCovers(identity.frontier, receipt.committedFrontier)
      ? publishedResult(receipt, identity.generationId)
      : pendingResult(
          receipt,
          identity.generationId,
          projectionFailure ?? "projection has not reached the committed frontier",
        );
  return outcome;
}
