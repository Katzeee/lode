import {
  canonicalJson,
  frontierEquals,
  type AuthorityReceipt,
  type AuthorityRecord,
  type FactFrontier,
  type InvocationId,
  type ReplicaId,
  type WorkspaceId,
  type Admission,
} from "../../domain/fact/index.js";
import { AuthorityFaultError } from "./errors.js";
import type { AuthorityAdmissionPolicy } from "./fact-authority.js";

export function notifyAdmissionAdvance(
  before: Admission,
  after: Admission,
  listener?: (frontier: FactFrontier) => void,
): void {
  if (after.kind !== "fault" && !frontierEquals(before.snapshot.frontier, after.snapshot.frontier)) {
    listener?.(after.snapshot.frontier);
  }
}

export type StoredRecordInspection = Readonly<{
  admission: Admission;
  recoveryAdmission: Admission;
  records: readonly AuthorityRecord[];
}>;

export function inspectStoredRecords(
  workspaceId: WorkspaceId,
  records: readonly unknown[],
  admit: AuthorityAdmissionPolicy,
): StoredRecordInspection {
  const admission = admit(workspaceId, records);
  if (admission.kind !== "fault") {
    return { admission, recoveryAdmission: admission, records: admittedAuthorityRecords(records) };
  }
  const prefix: unknown[] = [];
  let recoveryAdmission = admit(workspaceId, prefix);
  for (const [index, record] of records.entries()) {
    const candidate = index === records.length - 1 ? admission : admit(workspaceId, [...prefix, record]);
    if (candidate.kind === "fault") {
      break;
    }
    prefix.push(record);
    recoveryAdmission = candidate;
  }
  return {
    admission: { ...admission, snapshot: recoveryAdmission.snapshot },
    recoveryAdmission,
    records: admittedAuthorityRecords(prefix),
  };
}

function admittedAuthorityRecords(records: readonly unknown[]): readonly AuthorityRecord[] {
  // A non-fault Admission is the authority record shape and semantic boundary.
  return records as readonly AuthorityRecord[];
}

export function localReceiptsByInvocation(
  workspaceId: WorkspaceId,
  replicaId: ReplicaId,
  records: readonly AuthorityRecord[],
): ReadonlyMap<InvocationId, AuthorityReceipt> {
  const result = new Map<InvocationId, AuthorityReceipt>();
  for (const record of records) {
    if (
      record.recordKind !== "receipt" ||
      record.receipt.workspaceId !== workspaceId ||
      record.receipt.replicaId !== replicaId
    ) {
      continue;
    }
    const existing = result.get(record.receipt.invocationId);
    if (existing && canonicalJson(existing) !== canonicalJson(record.receipt)) {
      throw new AuthorityFaultError(`Invocation ledger conflict: ${replicaId}/${record.receipt.invocationId}`);
    }
    result.set(record.receipt.invocationId, record.receipt);
  }
  return result;
}
