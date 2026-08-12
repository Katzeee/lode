import type {
  CommittedProjectionPendingResult,
  EngineError,
  PublishedResult,
  RejectedResult,
  WriteResult,
} from "../../application/contract.js";
import type { AuthorityReceipt } from "../../domain/fact/index.js";
import {
  AuthorityCommitUnknownError,
  AuthorityFaultError,
  InvocationConflictError,
  ProjectionUnavailableError,
} from "../authority/errors.js";

export function publishedResult(receipt: AuthorityReceipt, generationId: string): PublishedResult {
  return { status: "published", receipt, generationId };
}

export function pendingResult(
  receipt: AuthorityReceipt,
  publishedGenerationId: string,
  failure: string,
): CommittedProjectionPendingResult {
  return { status: "committed-projection-pending", receipt, publishedGenerationId, failure };
}

export function rejectedResult(
  code: EngineError["code"],
  message: string,
  currentGenerationId: string,
): RejectedResult {
  return { status: "rejected", error: { code, message, currentGenerationId } };
}

export function executionErrorResult(error: unknown, currentGenerationId: string): WriteResult {
  if (error instanceof AuthorityCommitUnknownError) {
    return { status: "outcome-unknown", invocationId: error.invocationId };
  }
  if (error instanceof InvocationConflictError) {
    return rejectedResult("invocation-conflict", error.message, currentGenerationId);
  }
  if (error instanceof ProjectionUnavailableError) {
    return rejectedResult("projection-unavailable", error.message, currentGenerationId);
  }
  if (error instanceof AuthorityFaultError) {
    return rejectedResult("authority-fault", error.message, currentGenerationId);
  }
  return rejectedResult(
    "invalid-input",
    error instanceof Error ? error.message : String(error),
    currentGenerationId,
  );
}
