import type {
  CommittedProjectionPendingResult,
  EngineError,
  PublishedResult,
  RejectedResult,
  WriteResult,
} from "@lode/sdk";
import { frontierCovers, type Admission, type AuthorityReceipt } from "../../domain/fact/index.js";
import {
  AuthorityAdmissionError,
  AuthorityFaultError,
  InvocationConflictError,
  ProjectionUnavailableError,
} from "./authority/errors.js";

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
  if (error instanceof AuthorityAdmissionError) {
    return rejectedResult("invalid-input", error.message, currentGenerationId);
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
  throw error;
}

export async function finishWorkspaceReceipt(
  receipt: AuthorityReceipt,
  generationId: string,
  admission: Admission,
  publish: (receipt: AuthorityReceipt) => Promise<WriteResult>,
): Promise<WriteResult> {
  if (frontierCovers(admission.snapshot.frontier, receipt.committedFrontier)) {
    return publish(receipt);
  }
  return pendingResult(
    receipt,
    generationId,
    admission.kind === "fault"
      ? (admission.fault ?? "authority is faulted")
      : "authority Facts remain pending causal admission",
  );
}
