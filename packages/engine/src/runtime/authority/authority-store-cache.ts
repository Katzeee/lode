import type {
  Admission,
  AuthorityReceipt,
  AuthorityRecord,
  Fact,
  InvocationId,
  ReplicaId,
} from "../../domain/fact/index.js";
import type { AuthorityAdmissionPolicy } from "./fact-authority.js";
import { AuthorityQueryIndex } from "./authority-query-index.js";
import { sortedReceipts } from "./authority-store-queries.js";
import { deriveAuthorityCaches } from "./authority-store-state.js";

export class AuthorityStoreCache {
  private recordsValue: readonly unknown[] = [];
  private admissionValue!: Admission;
  private receiptsValue = new Map<InvocationId, AuthorityReceipt>();
  private index = AuthorityQueryIndex.build([], []);

  constructor(
    private readonly workspaceId: string,
    private readonly replicaId: ReplicaId,
    private readonly admitRecords: AuthorityAdmissionPolicy,
  ) {}

  refresh(records: readonly unknown[], admitted?: Admission): void {
    const caches = deriveAuthorityCaches(
      this.workspaceId,
      this.replicaId,
      records,
      this.admitRecords,
      admitted,
    );
    this.recordsValue = records;
    this.admissionValue = caches.admission;
    this.receiptsValue = new Map(caches.receipts);
    this.index = AuthorityQueryIndex.build(
      caches.admission.kind === "fault" ? [] : caches.admission.snapshot.facts,
      [...caches.receipts.values()],
    );
  }

  append(records: readonly AuthorityRecord[], admission: Admission): void {
    this.recordsValue = [...this.recordsValue, ...records];
    this.admissionValue = admission;
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

  occurrenceNodeId(occurrenceId: string): string | null {
    return this.index.occurrenceNodeId(occurrenceId);
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
