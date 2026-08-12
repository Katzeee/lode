import type { LoroDoc } from "loro-crdt";

import {
  canonicalJson,
  compareFacts,
  frontierEquals,
  type AuthorityReceipt,
  type AuthorityRecord,
  type Fact,
  type FactFrontier,
  type InvocationId,
  type ReplicaId,
  type WorkspaceId,
  type Admission,
} from "../../domain/fact/index.js";
import { AuthorityFaultError } from "./errors.js";
import type { AuthorityAdmissionPolicy } from "./fact-store.js";

export function readAuthorityRecords(doc: LoroDoc): unknown[] {
  return doc.getList("authority-records").toArray().map(parseStoredRecord);
}

export function notifyAdmissionAdvance(
  before: Admission,
  after: Admission,
  listener?: (frontier: FactFrontier) => void,
): void {
  if (
    after.kind !== "fault" &&
    !frontierEquals(before.snapshot.frontier, after.snapshot.frontier)
  ) {
    listener?.(after.snapshot.frontier);
  }
}

export function admitStoredRecords(
  workspaceId: WorkspaceId,
  records: readonly unknown[],
  admit: AuthorityAdmissionPolicy,
): Admission {
  const admission = admit(workspaceId, records);
  if (admission.kind !== "fault") {
    return admission;
  }
  const prefixAdmission = admit(workspaceId, validRecordPrefix(workspaceId, records, admit));
  return { ...admission, snapshot: prefixAdmission.snapshot };
}

export function validRecordPrefix(
  workspaceId: WorkspaceId,
  records: readonly unknown[],
  admit: AuthorityAdmissionPolicy,
): readonly unknown[] {
  const prefix: unknown[] = [];
  for (const record of records) {
    if (admit(workspaceId, [...prefix, record]).kind === "fault") {
      break;
    }
    prefix.push(record);
  }
  return prefix;
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
      throw new AuthorityFaultError(
        `Invocation ledger conflict: ${replicaId}/${record.receipt.invocationId}`,
      );
    }
    result.set(record.receipt.invocationId, record.receipt);
  }
  return result;
}

export function nextReplicaSequence(facts: readonly Fact[], replicaId: ReplicaId): number {
  return (
    facts.reduce(
      (maximum, fact) =>
        fact.coordinate.dot.replicaId === replicaId
          ? Math.max(maximum, fact.coordinate.dot.sequence)
          : maximum,
      0,
    ) + 1
  );
}

export function maxLamportAtFrontier(facts: readonly Fact[], frontier: FactFrontier): number {
  return (
    facts
      .filter(
        (fact) => (frontier[fact.coordinate.dot.replicaId] ?? 0) >= fact.coordinate.dot.sequence,
      )
      .sort(compareFacts)
      .at(-1)?.coordinate.lamport ?? 0
  );
}

function parseStoredRecord(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return { recordKind: "invalid-json" };
  }
}
