import {
  admitPlannedAuthorityAppend,
  frontierEquals,
  requestDigest,
  type Admission,
  type AuthorityReceipt,
  type AuthorityRecord,
  type Fact,
  type ReplicaId,
  type WorkspaceId,
} from "../../domain/fact/index.js";
import { createAuthorityCommitBatch } from "./authority-commit-batch.js";
import type { AuthorityAdmissionPolicy, AuthorityCommit } from "./fact-authority.js";
import { AuthorityFaultError, InvocationConflictError, ProjectionUnavailableError } from "./errors.js";

export type AuthorityCommitPlan =
  | Readonly<{ kind: "replay"; receipt: AuthorityReceipt }>
  | Readonly<{
      kind: "append";
      facts: readonly Fact[];
      receipt: AuthorityReceipt;
      records: readonly AuthorityRecord[];
      admission: Admission;
    }>;

export function planAuthorityCommit(
  input: AuthorityCommit,
  state: Readonly<{
    workspaceId: WorkspaceId;
    replicaId: ReplicaId;
    admission: Admission;
    records: readonly unknown[];
    existingReceipt: AuthorityReceipt | null;
    maximumLamport: number;
    previousChannelReceipt: AuthorityReceipt | null;
    admitRecords: AuthorityAdmissionPolicy;
  }>,
): AuthorityCommitPlan {
  const digest = requestDigest(input.request);
  if (state.existingReceipt) {
    if (state.existingReceipt.requestDigest !== digest) {
      throw new InvocationConflictError(`Invocation request conflict: ${input.invocationId}`);
    }
    return { kind: "replay", receipt: state.existingReceipt };
  }
  if (
    input.writes.length === 0 ||
    input.writes.some((write) => write.kind === "transaction" && write.bodies.length === 0)
  ) {
    throw new Error("Authority commit requires non-empty Fact transactions");
  }
  if (state.admission.kind === "fault") {
    throw new AuthorityFaultError(state.admission.fault ?? "Authority admission fault");
  }
  if (!frontierEquals(state.admission.snapshot.frontier, input.publishedFrontier)) {
    throw new ProjectionUnavailableError(
      "State-dependent command requires a complete generation at the admitted frontier",
    );
  }

  const { facts, receipt, records } = createAuthorityCommitBatch(
    state.workspaceId,
    state.replicaId,
    input,
    digest,
    state.admission.snapshot,
    state.maximumLamport,
  );
  const candidate = admitPlannedAuthorityAppend(
    state.workspaceId,
    state.admission.snapshot,
    records,
    state.maximumLamport,
    state.previousChannelReceipt,
  );
  if (candidate.kind !== "ready") {
    throw new Error(candidate.fault ?? "Local Fact batch did not admit completely");
  }
  const admission = state.admitRecords(state.workspaceId, [...state.records, ...records]);
  assertLocalFactsAdmitted(candidate, admission, facts);
  return { kind: "append", facts, receipt, records, admission };
}

function assertLocalFactsAdmitted(planned: Admission, policy: Admission, facts: readonly Fact[]): void {
  const admittedFactIds = new Set(policy.snapshot.facts.map((fact) => fact.id));
  if (
    policy.kind === "fault" ||
    !frontierEquals(policy.snapshot.frontier, planned.snapshot.frontier) ||
    facts.some((fact) => !admittedFactIds.has(fact.id))
  ) {
    throw new Error(policy.fault ?? "Local Fact transactions violate admission policy");
  }
}
