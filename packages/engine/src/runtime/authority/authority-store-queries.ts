import {
  stableStringCompare,
  type Admission,
  type AuthorityReceipt,
  type FactSnapshot,
  type InvocationId,
} from "../../domain/fact/index.js";
import { AuthorityFaultError } from "./errors.js";

export function admittedSnapshot(admission: Admission): FactSnapshot {
  if (admission.kind === "fault") {
    throw new AuthorityFaultError(admission.fault ?? "Authority admission fault");
  }
  return admission.snapshot;
}

export function sortedReceipts(receipts: Iterable<AuthorityReceipt>): AuthorityReceipt[] {
  return [...receipts].sort(
    (left, right) =>
      (left.lineage?.ordinal ?? Number.MAX_SAFE_INTEGER) -
        (right.lineage?.ordinal ?? Number.MAX_SAFE_INTEGER) ||
      stableStringCompare(left.invocationId, right.invocationId),
  );
}

export function sortedInvocationIds(values: Iterable<InvocationId>): InvocationId[] {
  return [...values].sort(stableStringCompare);
}
