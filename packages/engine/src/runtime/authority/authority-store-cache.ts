import type {
  Admission,
  AuthorityReceipt,
  AuthorityRecord,
  Fact,
  InvocationId,
  ReplicaId,
} from "../../domain/fact/index.js";
import type { AuthorityAdmissionPolicy, AuthorityIndexObserver } from "./fact-authority.js";
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
    private readonly onIndexedWork: AuthorityIndexObserver | undefined,
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
    this.note("authority-local-append", records.length);
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
    const receipts = this.index.receiptsForChannel(channelId);
    this.note("history-receipts", receipts.length);
    return receipts;
  }

  facts(factIds: readonly string[]): readonly Fact[] {
    const facts = this.index.facts(factIds);
    this.note("fact-id-read", facts.length);
    return facts;
  }

  relatedFacts(factIds: readonly string[]): readonly Fact[] {
    const facts = this.index.relatedFacts(factIds);
    this.note("related-fact-read", facts.length);
    return facts;
  }

  occurrenceNodeId(occurrenceId: string): string | null {
    this.note("occurrence-node-read", 1);
    return this.index.occurrenceNodeId(occurrenceId);
  }

  historyImpacts(nodeId: string) {
    const impacts = this.index.historyImpacts(nodeId);
    this.note("history-impact-read", impacts.length);
    return impacts;
  }

  maximumLamport(): number {
    return this.index.maximumLamport();
  }

  lastReceiptForChannel(channelId: string): AuthorityReceipt | null {
    return this.index.lastReceiptForChannel(channelId);
  }

  private note(operation: string, units: number): void {
    this.onIndexedWork?.({ operation, units });
  }
}
