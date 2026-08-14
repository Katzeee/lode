import type { InvocationOutcome, InvocationQuery } from "../../../application/contract.js";
import { frontierCovers } from "../../../domain/fact/index.js";
import type { FactAuthority } from "../../authority/fact-authority.js";
import type { ProjectionIdentityReader } from "../../materialization/index.js";
import { pendingResult, publishedResult } from "../workspace-results.js";

type InvocationFactReader = Pick<FactAuthority, "receipt" | "settleInvocation">;

export async function queryWorkspaceInvocation(
  query: InvocationQuery,
  facts: InvocationFactReader,
  projections: ProjectionIdentityReader,
  generationId: string,
  projectionFailure: string | null,
): Promise<InvocationOutcome> {
  const identity = await projections.identity(generationId);
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
  facts.settleInvocation(query.invocationId);
  return outcome;
}
