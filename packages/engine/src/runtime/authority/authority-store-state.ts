import {
  parseAuthorityRecords,
  type Admission,
  type AuthorityReceipt,
  type AuthorityRecord,
  type InvocationId,
  type ReplicaId,
  type WorkspaceId,
} from "../../domain/fact/index.js";
import type { AuthorityAdmissionPolicy } from "./fact-authority.js";
import {
  admitStoredRecords,
  localReceiptsByInvocation,
  validRecordPrefix,
} from "./authority-records.js";

export type AuthorityCaches = Readonly<{
  admission: Admission;
  parsedRecords: readonly AuthorityRecord[];
  receipts: ReadonlyMap<InvocationId, AuthorityReceipt>;
}>;

export function deriveAuthorityCaches(
  workspaceId: WorkspaceId,
  replicaId: ReplicaId,
  records: readonly unknown[],
  admit: AuthorityAdmissionPolicy,
  admitted?: Admission,
): AuthorityCaches {
  try {
    const admission = admitted ?? admitStoredRecords(workspaceId, records, admit);
    const receiptRecords =
      admission.kind === "fault" ? validRecordPrefix(workspaceId, records, admit) : records;
    const parsedRecords = parseAuthorityRecords(receiptRecords);
    return {
      admission,
      parsedRecords,
      receipts: new Map(localReceiptsByInvocation(workspaceId, replicaId, parsedRecords)),
    };
  } catch (error) {
    return {
      admission: {
        kind: "fault",
        snapshot: { facts: [], frontier: {} },
        pendingTransactionIds: [],
        fault: error instanceof Error ? error.message : String(error),
      },
      parsedRecords: [],
      receipts: new Map(),
    };
  }
}
