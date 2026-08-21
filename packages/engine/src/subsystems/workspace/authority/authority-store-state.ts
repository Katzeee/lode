import {
  type Admission,
  type AuthorityReceipt,
  type AuthorityRecord,
  type InvocationId,
  type ReplicaId,
  type WorkspaceId,
} from "../../../domain/fact/index.js";
import type { AuthorityAdmissionPolicy } from "./authority-contract.js";
import { inspectStoredRecords, localReceiptsByInvocation } from "./authority-records.js";

export type AuthorityCaches = Readonly<{
  admission: Admission;
  recoveryAdmission: Admission;
  parsedRecords: readonly AuthorityRecord[];
  receipts: ReadonlyMap<InvocationId, AuthorityReceipt>;
}>;

export function deriveAuthorityCaches(
  workspaceId: WorkspaceId,
  replicaId: ReplicaId,
  records: readonly unknown[],
  admit: AuthorityAdmissionPolicy,
): AuthorityCaches {
  try {
    const inspected = inspectStoredRecords(workspaceId, records, admit);
    const parsedRecords = inspected.records;
    return {
      admission: inspected.admission,
      recoveryAdmission: inspected.recoveryAdmission,
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
      recoveryAdmission: {
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
