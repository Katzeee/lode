import {
  admitPlannedAuthorityAppend,
  canonicalDigest,
  frontierEquals,
  requestDigest,
  type Admission,
  type AuthorityReceipt,
  type AuthorityRecord,
  type FactSnapshot,
  type InvocationId,
  type ReplicaId,
} from "../../domain/fact/index.js";
import type { SyncBytes, SyncableDoc } from "../../sync/syncable.js";
import { SerialExecutor } from "../kernel/serial-executor.js";
import type {
  AuthorityAdmissionPolicy,
  AuthorityCommit,
  AuthorityCommitResult,
  FactAuthority,
} from "./fact-authority.js";
import {
  AuthorityCommitUnknownError,
  AuthorityFaultError,
  InvocationConflictError,
  ProjectionUnavailableError,
} from "./errors.js";
import { notifyAdmissionAdvance } from "./authority-records.js";
import { recoverAuthorityJournal } from "./authority-recovery.js";
import {
  appendAuthorityBatch,
  loadAuthorityJournal,
  writeAuthoritySnapshot,
} from "./authority-journal.js";
import { validateReplicaId } from "./replica-identity.js";
import { LoroFactReplica } from "./loro-fact-replica.js";
import { createAuthorityCommitBatch } from "./authority-commit-batch.js";
import { assertLocalFactsAdmitted } from "./authority-local-admission.js";
import {
  FACT_AUTHORITY_JOURNAL_DOCUMENT_ID,
  type FactAuthorityStoreOptions,
} from "./fact-authority-store-options.js";
import { admittedSnapshot, sortedInvocationIds } from "./authority-store-queries.js";
import { AuthorityStoreCache } from "./authority-store-cache.js";

export { createReplicaId } from "./replica-identity.js";
export { FACT_AUTHORITY_JOURNAL_DOCUMENT_ID } from "./fact-authority-store-options.js";

export class FactAuthorityStore implements FactAuthority {
  readonly replication: SyncableDoc;
  private readonly replicaKernel: LoroFactReplica;
  private readonly serial = new SerialExecutor();
  private updatesSinceSnapshot: number;
  private readonly cache: AuthorityStoreCache;
  private readonly uncertain = new Set<InvocationId>();
  private readonly admitRecords: AuthorityAdmissionPolicy;

  private constructor(
    private readonly options: FactAuthorityStoreOptions,
    records: readonly unknown[],
    replicaKernel: LoroFactReplica,
    updatesSinceSnapshot: number,
    readonly replicaId: ReplicaId,
  ) {
    this.admitRecords = options.admitRecords;
    this.replicaKernel = replicaKernel;
    this.updatesSinceSnapshot = updatesSinceSnapshot;
    this.cache = new AuthorityStoreCache(
      options.workspaceId,
      replicaId,
      this.admitRecords,
      options.onIndexedWork,
    );
    this.cache.refresh(records);
    this.replication = replicaKernel.syncDoc;
  }

  static async open(options: FactAuthorityStoreOptions): Promise<FactAuthorityStore> {
    validateReplicaId(options.replicaId);
    const loaded = await loadAuthorityJournal(
      options.documents,
      FACT_AUTHORITY_JOURNAL_DOCUMENT_ID,
    );
    const owner: { store?: FactAuthorityStore } = {};
    const replica = await LoroFactReplica.open(
      {
        workspaceId: options.workspaceId,
        loroPeerId: options.loroPeerId,
        documents: options.documents,
        admitRecords: options.admitRecords,
      },
      loaded.records,
      (bytes) => requiredStore(owner).importUpdate(bytes),
      () => {
        const store = requiredStore(owner);
        return store.serial.run(() => store.replicaKernel.heal(store.admission()));
      },
    );
    const store = new FactAuthorityStore(
      options,
      loaded.records,
      replica,
      loaded.updateCount,
      options.replicaId,
    );
    owner.store = store;
    return store;
  }

  admission = (): Admission => this.cache.admission();

  snapshot = () => admittedSnapshot(this.admission());

  receipt = (invocationId: InvocationId): AuthorityReceipt | null =>
    this.cache.receipt(invocationId);

  receipts = (): readonly AuthorityReceipt[] => this.cache.receipts();

  receiptsForChannel(channelId: string): readonly AuthorityReceipt[] {
    return this.cache.receiptsForChannel(channelId);
  }

  facts(factIds: readonly string[]) {
    return this.cache.facts(factIds);
  }

  relatedFacts(factIds: readonly string[]) {
    return this.cache.relatedFacts(factIds);
  }

  occurrenceNodeId(occurrenceId: string): string | null {
    return this.cache.occurrenceNodeId(occurrenceId);
  }

  historyImpacts(nodeId: string) {
    return this.cache.historyImpacts(nodeId);
  }

  uncertainInvocations = (): readonly InvocationId[] => sortedInvocationIds(this.uncertain);

  settleInvocation = (invocationId: InvocationId): void => void this.uncertain.delete(invocationId);

  recoverToLastValidPrefix = (): Promise<FactSnapshot> =>
    this.serial.run(() => this.recoverExclusive());

  compact = (): Promise<void> => this.serial.run(() => this.compactExclusive());

  commit = (input: AuthorityCommit): Promise<AuthorityCommitResult> =>
    this.serial.run(() => this.commitExclusive(input));

  private async commitExclusive(input: AuthorityCommit): Promise<AuthorityCommitResult> {
    const digest = requestDigest(input.request);
    const existing = this.receipt(input.invocationId);
    if (existing) {
      if (existing.requestDigest !== digest) {
        throw new InvocationConflictError(`Invocation request conflict: ${input.invocationId}`);
      }
      await this.replicaKernel.heal(this.admission());
      this.uncertain.delete(input.invocationId);
      return { receipt: existing, created: false };
    }
    if (
      input.writes.length === 0 ||
      input.writes.some((write) => write.kind === "transaction" && write.bodies.length === 0)
    ) {
      throw new Error("Authority commit requires non-empty Fact transactions");
    }

    const before = this.admission();
    if (before.kind === "fault") {
      throw new AuthorityFaultError(before.fault ?? "Authority admission fault");
    }
    if (!frontierEquals(before.snapshot.frontier, input.publishedFrontier)) {
      throw new ProjectionUnavailableError(
        "State-dependent command requires a complete generation at the admitted frontier",
      );
    }

    const { facts, receipt, records } = createAuthorityCommitBatch(
      this.options.workspaceId,
      this.replicaId,
      input,
      digest,
      before.snapshot,
      this.cache.maximumLamport(),
    );
    const candidate = admitPlannedAuthorityAppend(
      this.options.workspaceId,
      before.snapshot,
      records,
      this.cache.maximumLamport(),
      input.lineage ? this.cache.lastReceiptForChannel(input.lineage.channelId) : null,
    );
    if (candidate.kind !== "ready") {
      throw new Error(candidate.fault ?? "Local Fact batch did not admit completely");
    }
    const domainCandidate = this.admitRecords(this.options.workspaceId, [
      ...this.cache.records(),
      ...records,
    ]);
    assertLocalFactsAdmitted(candidate, domainCandidate, facts);
    try {
      await this.appendRecords(records, domainCandidate, false);
    } catch (error) {
      await this.adoptDurableAuthorityAfterUnknown();
      this.uncertain.add(input.invocationId);
      throw new AuthorityCommitUnknownError(input.invocationId, { cause: error });
    }
    try {
      await this.replicaKernel.publish(facts);
      await this.compactIfNeeded();
    } catch (error) {
      this.uncertain.add(input.invocationId);
      throw new AuthorityCommitUnknownError(input.invocationId, { cause: error });
    }
    return { receipt, created: true };
  }

  private async appendRecords(
    records: readonly AuthorityRecord[],
    admitted?: Admission,
    compact = true,
  ): Promise<void> {
    const before = this.admission();
    await appendAuthorityBatch(this.options.documents, FACT_AUTHORITY_JOURNAL_DOCUMENT_ID, records);
    if (admitted) {
      this.cache.append(records, admitted);
    } else {
      this.cache.refresh([...this.cache.records(), ...records]);
    }
    this.updatesSinceSnapshot += 1;
    if (compact) {
      await this.compactIfNeeded();
    }
    notifyAdmissionAdvance(before, this.admission(), this.options.onAuthorityAdvanced);
  }

  private async importUpdate(bytes: SyncBytes): Promise<void> {
    return this.serial.run(() => this.importUpdateExclusive(bytes));
  }

  private async importUpdateExclusive(bytes: SyncBytes): Promise<void> {
    const before = this.admission();
    if (before.kind === "fault") {
      throw new AuthorityFaultError(before.fault ?? "Authority admission fault");
    }
    const authorityRecords = this.cache.records();
    const validation = this.replicaKernel.prepareImport(bytes, authorityRecords);
    if (validation.kind === "fault") {
      const durableRecords =
        validation.records.length > 0
          ? validation.records
          : [
              {
                recordKind: "quarantine" as const,
                reason: validation.reason,
                updateDigest: canonicalDigest([...bytes]),
              },
            ];
      await this.appendRecords(durableRecords);
      throw new AuthorityFaultError(validation.reason);
    }
    if (validation.records.length > 0) {
      await this.appendRecords(validation.records);
    }
    await validation.accept();
  }

  private async recoverExclusive(): Promise<FactSnapshot> {
    const before = this.admission();
    if (before.kind !== "fault") {
      return before.snapshot;
    }
    const recovered = await recoverAuthorityJournal({
      workspaceId: this.options.workspaceId,
      documents: this.options.documents,
      documentId: FACT_AUTHORITY_JOURNAL_DOCUMENT_ID,
      records: this.cache.records(),
      admitRecords: this.admitRecords,
      onAuthorityAdvanced: this.options.onAuthorityAdvanced,
    });
    this.cache.refresh(recovered.records);
    await this.replicaKernel.rebuild(recovered.records);
    this.updatesSinceSnapshot = 0;
    return recovered.snapshot;
  }

  private compactIfNeeded(): Promise<void> {
    return this.updatesSinceSnapshot >= (this.options.snapshotInterval ?? 64)
      ? this.compactExclusive()
      : Promise.resolve();
  }

  private async compactExclusive(): Promise<void> {
    await writeAuthoritySnapshot(
      this.options.documents,
      FACT_AUTHORITY_JOURNAL_DOCUMENT_ID,
      this.cache.records(),
    );
    this.updatesSinceSnapshot = 0;
  }

  private async adoptDurableAuthorityAfterUnknown(): Promise<void> {
    try {
      const before = this.admission();
      const loaded = await loadAuthorityJournal(
        this.options.documents,
        FACT_AUTHORITY_JOURNAL_DOCUMENT_ID,
      );
      this.updatesSinceSnapshot = loaded.updateCount;
      this.cache.refresh(loaded.records);
      if (this.admission().kind === "ready") {
        await this.replicaKernel.publish(this.admission().snapshot.facts);
      }
      notifyAdmissionAdvance(before, this.admission(), this.options.onAuthorityAdvanced);
    } catch {
      // The caller retains outcome-unknown when durable authority cannot be audited.
    }
  }
}

function requiredStore(owner: Readonly<{ store?: FactAuthorityStore }>): FactAuthorityStore {
  if (!owner.store) {
    throw new Error("Fact authority store is not initialized");
  }
  return owner.store;
}
