import type {
  Admission,
  AuthorityReceipt,
  AuthorityRecord,
  Fact,
  FactFrontier,
  FactSnapshot,
  InvocationId,
  ReplicaId,
  WorkspaceId,
} from "../../domain/fact/index.js";
import type { DocumentStore } from "../../persistence/document-store.js";
import { AuthorityStoreCache } from "./authority-store-cache.js";
import { notifyAdmissionAdvance } from "./authority-records.js";
import { recoverAuthorityJournal } from "./authority-recovery.js";
import {
  FACT_AUTHORITY_JOURNAL_DOCUMENT_ID,
  appendAuthorityBatch,
  loadAuthorityJournal,
  writeAuthoritySnapshot,
} from "./authority-journal.js";
import type { AuthorityAdmissionPolicy } from "./fact-authority.js";
import { admittedSnapshot } from "./authority-store-queries.js";

type AuthorityJournalOptions = Readonly<{
  workspaceId: WorkspaceId;
  replicaId: ReplicaId;
  documents: DocumentStore;
  admitRecords: AuthorityAdmissionPolicy;
  onAuthorityAdvanced?: (frontier: FactFrontier) => void;
  snapshotInterval?: number;
}>;

export class AuthorityJournalSession {
  private readonly cache: AuthorityStoreCache;

  private constructor(
    private readonly options: AuthorityJournalOptions,
    records: readonly unknown[],
    private updatesSinceSnapshot: number,
  ) {
    this.cache = new AuthorityStoreCache(options.workspaceId, options.replicaId, options.admitRecords);
    this.cache.refresh(records);
  }

  static async open(options: AuthorityJournalOptions): Promise<AuthorityJournalSession> {
    const loaded = await loadAuthorityJournal(options.documents, FACT_AUTHORITY_JOURNAL_DOCUMENT_ID);
    return new AuthorityJournalSession(options, loaded.records, loaded.updateCount);
  }

  admission(): Admission {
    return this.cache.admission();
  }

  snapshot(): FactSnapshot {
    return admittedSnapshot(this.admission());
  }

  records(): readonly unknown[] {
    return this.cache.records();
  }

  validRecords(): readonly AuthorityRecord[] {
    return this.cache.validRecords();
  }

  receipt(invocationId: InvocationId): AuthorityReceipt | null {
    return this.cache.receipt(invocationId);
  }

  receipts(): readonly AuthorityReceipt[] {
    return this.cache.receipts();
  }

  receiptsForChannel(channelId: string): readonly AuthorityReceipt[] {
    return this.cache.receiptsForChannel(channelId);
  }

  facts(factIds: readonly string[]): readonly Fact[] {
    return this.cache.facts(factIds);
  }

  relatedFacts(factIds: readonly string[]): readonly Fact[] {
    return this.cache.relatedFacts(factIds);
  }

  occurrenceNodeId(occurrenceId: string): string | null {
    return this.cache.occurrenceNodeId(occurrenceId);
  }

  historyImpacts(nodeId: string) {
    return this.cache.historyImpacts(nodeId);
  }

  maximumLamport(): number {
    return this.cache.maximumLamport();
  }

  lastReceiptForChannel(channelId: string): AuthorityReceipt | null {
    return this.cache.lastReceiptForChannel(channelId);
  }

  async append(records: readonly AuthorityRecord[], admission?: Admission, compact = true): Promise<void> {
    const before = this.admission();
    await appendAuthorityBatch(this.options.documents, FACT_AUTHORITY_JOURNAL_DOCUMENT_ID, records);
    if (admission) {
      this.cache.append(records, admission);
    } else {
      this.cache.refresh([...this.cache.records(), ...records]);
    }
    this.updatesSinceSnapshot += 1;
    if (compact) {
      await this.compactIfNeeded();
    }
    notifyAdmissionAdvance(before, this.admission(), this.options.onAuthorityAdvanced);
  }

  async recover(): Promise<FactSnapshot> {
    const before = this.admission();
    if (before.kind !== "fault") {
      return before.snapshot;
    }
    const recoveryAdmission = this.cache.recoveryAdmission();
    const recovered = await recoverAuthorityJournal({
      documents: this.options.documents,
      documentId: FACT_AUTHORITY_JOURNAL_DOCUMENT_ID,
      before,
      records: this.cache.validRecords(),
      recoveryAdmission,
      onAuthorityAdvanced: this.options.onAuthorityAdvanced,
    });
    this.cache.replaceWithRecovery(recovered.records, recoveryAdmission);
    this.updatesSinceSnapshot = 0;
    return recovered.snapshot;
  }

  async reloadDurable(adopt: (admission: Admission) => Promise<void>): Promise<void> {
    const before = this.admission();
    const loaded = await loadAuthorityJournal(this.options.documents, FACT_AUTHORITY_JOURNAL_DOCUMENT_ID);
    this.updatesSinceSnapshot = loaded.updateCount;
    this.cache.refresh(loaded.records);
    const after = this.admission();
    await adopt(after);
    notifyAdmissionAdvance(before, after, this.options.onAuthorityAdvanced);
  }

  compactIfNeeded(): Promise<void> {
    return this.updatesSinceSnapshot >= (this.options.snapshotInterval ?? 64) ? this.compact() : Promise.resolve();
  }

  async compact(): Promise<void> {
    await writeAuthoritySnapshot(this.options.documents, FACT_AUTHORITY_JOURNAL_DOCUMENT_ID, this.cache.records());
    this.updatesSinceSnapshot = 0;
  }
}
