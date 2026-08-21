import type {
  Admission,
  AuthorityReceipt,
  AuthorityRecord,
  Fact,
  InvocationId,
  ReplicaId,
} from "../../../domain/fact/index.js";
import type { AuthorityAdmissionPolicy } from "./authority-contract.js";
import { localReceiptsByInvocation } from "./authority-records.js";
import { AuthorityQueryIndex } from "./authority-query-index.js";
import { sortedReceipts } from "./authority-store-queries.js";
import { deriveAuthorityCaches } from "./authority-store-state.js";

export class AuthorityStoreCache {
  private recordsValue: readonly unknown[] = [];
  private admissionValue!: Admission;
  private recoveryAdmissionValue!: Admission;
  private validRecordsValue: readonly AuthorityRecord[] = [];
  private receiptsValue = new Map<InvocationId, AuthorityReceipt>();
  private index = AuthorityQueryIndex.build([], []);

  constructor(
    private readonly workspaceId: string,
    private readonly replicaId: ReplicaId,
    private readonly admitRecords: AuthorityAdmissionPolicy,
  ) {}

  refresh(records: readonly unknown[]): void {
    const caches = deriveAuthorityCaches(this.workspaceId, this.replicaId, records, this.admitRecords);
    this.recordsValue = records;
    this.admissionValue = caches.admission;
    this.recoveryAdmissionValue = caches.recoveryAdmission;
    this.validRecordsValue = caches.parsedRecords;
    this.receiptsValue = new Map(caches.receipts);
    this.index = AuthorityQueryIndex.build(caches.admission.kind === "fault" ? [] : caches.admission.snapshot.facts, [
      ...caches.receipts.values(),
    ]);
  }

  replaceWithRecovery(records: readonly AuthorityRecord[], admission: Admission): void {
    this.recordsValue = records;
    this.admissionValue = admission;
    this.recoveryAdmissionValue = admission;
    this.validRecordsValue = records;
    this.receiptsValue = new Map(localReceiptsByInvocation(this.workspaceId, this.replicaId, records));
    this.index = AuthorityQueryIndex.build(admission.snapshot.facts, [...this.receiptsValue.values()]);
  }

  append(records: readonly AuthorityRecord[], admission: Admission): void {
    this.recordsValue = [...this.recordsValue, ...records];
    this.admissionValue = admission;
    this.recoveryAdmissionValue = admission;
    this.validRecordsValue = [...this.validRecordsValue, ...records];
    for (const record of records) {
      if (
        record.recordKind === "receipt" &&
        record.receipt.workspaceId === this.workspaceId &&
        record.receipt.replicaId === this.replicaId
      ) {
        this.receiptsValue.set(record.receipt.invocationId, record.receipt);
      }
    }
    this.index.append(records);
  }

  admission(): Admission {
    return this.admissionValue;
  }

  records(): readonly unknown[] {
    return this.recordsValue;
  }

  validRecords(): readonly AuthorityRecord[] {
    return this.validRecordsValue;
  }

  recoveryAdmission(): Admission {
    return this.recoveryAdmissionValue;
  }

  receipt(invocationId: InvocationId): AuthorityReceipt | null {
    return this.receiptsValue.get(invocationId) ?? null;
  }

  receipts(): readonly AuthorityReceipt[] {
    return sortedReceipts(this.receiptsValue.values());
  }

  receiptsForChannel(channelId: string): readonly AuthorityReceipt[] {
    return this.index.receiptsForChannel(channelId);
  }

  facts(factIds: readonly string[]): readonly Fact[] {
    return this.index.facts(factIds);
  }

  relatedFacts(factIds: readonly string[]): readonly Fact[] {
    return this.index.relatedFacts(factIds);
  }

  historyImpacts(nodeId: string) {
    return this.index.historyImpacts(nodeId);
  }

  maximumLamport(): number {
    return this.index.maximumLamport();
  }

  lastReceiptForChannel(channelId: string): AuthorityReceipt | null {
    return this.index.lastReceiptForChannel(channelId);
  }
}
