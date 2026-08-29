import type {
  CommittedProjectionPendingResult,
  AuthorityReceipt as PublicAuthorityReceipt,
  EngineError,
  PublishedResult,
  RejectedResult,
  WriteResult,
} from "@lode/sdk";
import { frontierCovers, type FactSnapshot, type AuthorityReceipt } from "../../domain/fact/index.js";
import { FactValidationError, InvocationConflictError, ProjectionUnavailableError } from "./authority/errors.js";

export function publishedResult(receipt: AuthorityReceipt, generationId: string): PublishedResult {
  return { status: "published", receipt: publicReceipt(receipt), generationId };
}

export function pendingResult(
  receipt: AuthorityReceipt,
  publishedGenerationId: string,
  failure: string,
): CommittedProjectionPendingResult {
  return { status: "committed-projection-pending", receipt: publicReceipt(receipt), publishedGenerationId, failure };
}

function publicReceipt(receipt: AuthorityReceipt): PublicAuthorityReceipt {
  return {
    workspaceId: receipt.workspaceId,
    replicaId: receipt.replicaId,
    invocationId: receipt.invocationId,
    requestDigest: receipt.requestDigest,
    factIds: receipt.factIds,
    committedFrontier: receipt.committedFrontier,
    lineage: receipt.lineage,
  };
}

export function rejectedResult(
  code: EngineError["code"],
  message: string,
  currentGenerationId: string,
): RejectedResult {
  return { status: "rejected", error: { code, message, currentGenerationId } };
}

export function executionErrorResult(error: unknown, currentGenerationId: string): WriteResult {
  if (error instanceof FactValidationError) {
    return rejectedResult("invalid-input", error.message, currentGenerationId);
  }
  if (error instanceof InvocationConflictError) {
    return rejectedResult("invocation-conflict", error.message, currentGenerationId);
  }
  if (error instanceof ProjectionUnavailableError) {
    return rejectedResult("projection-unavailable", error.message, currentGenerationId);
  }
  throw error;
}

export function finishWorkspaceReceipt(
  receipt: AuthorityReceipt,
  generationId: string,
  snapshot: FactSnapshot,
  publish: (receipt: AuthorityReceipt) => WriteResult,
): WriteResult {
  if (frontierCovers(snapshot.frontier, receipt.committedFrontier)) {
    return publish(receipt);
  }
  return pendingResult(receipt, generationId, "authority publication has not reached the committed Loro version");
}
