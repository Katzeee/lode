import type { LoroDoc } from "loro-crdt";

import {
  admitPlannedAuthorityAppend,
  admitAuthorityRecordShapes,
  canonicalDigest,
  canonicalJson,
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
  FactStore,
} from "./fact-store.js";
import {
  AuthorityCommitUnknownError,
  AuthorityFaultError,
  InvocationConflictError,
  ProjectionUnavailableError,
} from "./errors.js";
import { notifyAdmissionAdvance, readAuthorityRecords } from "./loro-authority-records.js";
import { recoverAuthorityDocument } from "./authority-recovery.js";
import { validateReplicaId } from "./replica-identity.js";
import { addFactsToSyncProjection, createFactSyncDoc } from "./fact-sync-projection.js";
import {
  healFactSyncProjection,
  loadAuthorityDocument,
  loadSyncProjection,
  persistSyncProjection,
} from "./authority-store-state.js";
import { validateStagedSyncImport } from "./sync-import-validation.js";
import { createAuthorityCommitBatch } from "./authority-commit-batch.js";
import {
  FACT_AUTHORITY_DOCUMENT_ID,
  type LoroFactStoreOptions,
} from "./loro-fact-store-options.js";
import { admittedSnapshot, sortedInvocationIds } from "./authority-store-queries.js";
import { AuthorityStoreCache } from "./authority-store-cache.js";

export { createReplicaId } from "./replica-identity.js";
export { FACT_AUTHORITY_DOCUMENT_ID } from "./loro-fact-store-options.js";

export class LoroFactStore implements FactStore {
  readonly syncDoc: SyncableDoc;
  private doc: LoroDoc;
  private syncProjection: LoroDoc;
  private readonly serial = new SerialExecutor();
  private updatesSinceSnapshot: number;
  private readonly cache: AuthorityStoreCache;
  private readonly uncertain = new Set<InvocationId>();
  private readonly admitRecords: AuthorityAdmissionPolicy;

  private constructor(
    private readonly options: LoroFactStoreOptions,
    doc: LoroDoc,
    syncProjection: LoroDoc,
    updatesSinceSnapshot: number,
    readonly replicaId: ReplicaId,
  ) {
    this.admitRecords = options.admitRecords ?? admitAuthorityRecordShapes;
    this.doc = doc;
    this.syncProjection = syncProjection;
    this.updatesSinceSnapshot = updatesSinceSnapshot;
    this.cache = new AuthorityStoreCache(
      options.workspaceId,
      replicaId,
      this.admitRecords,
      options.onIndexedWork,
    );
    this.cache.refresh(readAuthorityRecords(doc));
    this.syncDoc = createFactSyncDoc(
      FACT_AUTHORITY_DOCUMENT_ID,
      () => this.syncProjection,
      (bytes) => this.importUpdate(bytes),
      () =>
        this.serial.run(() =>
          healFactSyncProjection(this.options.documents, this.syncProjection, this.admission()),
        ),
    );
  }

  static async open(options: LoroFactStoreOptions): Promise<LoroFactStore> {
    validateReplicaId(options.replicaId);
    const loaded = await loadAuthorityDocument(
      options.documents,
      FACT_AUTHORITY_DOCUMENT_ID,
      options.loroPeerId,
    );
    const doc = loaded.doc;
    const syncProjection = await loadSyncProjection(options, doc);
    return new LoroFactStore(options, doc, syncProjection, loaded.updateCount, options.replicaId);
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
      await healFactSyncProjection(this.options.documents, this.syncProjection, this.admission());
      this.uncertain.delete(input.invocationId);
      return { receipt: existing, created: false };
    }
    if (input.bodies.length === 0) {
      throw new Error("Authority commit requires a non-empty Fact batch");
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
    try {
      await this.appendRecords(records, candidate, false);
    } catch (error) {
      await this.adoptDurableAuthorityAfterUnknown();
      this.uncertain.add(input.invocationId);
      throw new AuthorityCommitUnknownError(input.invocationId, { cause: error });
    }
    addFactsToSyncProjection(this.syncProjection, facts);
    try {
      await persistSyncProjection(this.options.documents, this.syncProjection);
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
    const beforeVersion = this.doc.version();
    const staged = this.doc.fork();
    staged.setPeerId(this.options.loroPeerId);
    const list = staged.getList<string>("authority-records");
    for (const record of records) {
      list.push(canonicalJson(record));
    }
    staged.commit({ message: "authority-commit" });
    const update = staged.export({ mode: "update", from: beforeVersion });
    await this.options.documents.appendUpdate(FACT_AUTHORITY_DOCUMENT_ID, update);
    this.doc = staged;
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
    const stagedSync = this.syncProjection.fork();
    stagedSync.setPeerId(this.options.loroPeerId);
    stagedSync.import(bytes);
    const validation = validateStagedSyncImport(
      this.options.workspaceId,
      authorityRecords,
      stagedSync,
      this.admitRecords,
    );
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
    this.syncProjection = stagedSync;
    await persistSyncProjection(this.options.documents, this.syncProjection);
  }

  private async recoverExclusive(): Promise<FactSnapshot> {
    const before = this.admission();
    if (before.kind !== "fault") {
      return before.snapshot;
    }
    const recovered = await recoverAuthorityDocument({
      ...this.options,
      documentId: FACT_AUTHORITY_DOCUMENT_ID,
      doc: this.doc,
      admitRecords: this.admitRecords,
    });
    this.doc = recovered.doc;
    this.syncProjection = recovered.syncProjection;
    await persistSyncProjection(this.options.documents, this.syncProjection);
    this.updatesSinceSnapshot = 0;
    this.cache.refresh(readAuthorityRecords(this.doc));
    return recovered.snapshot;
  }

  private compactIfNeeded(): Promise<void> {
    return this.updatesSinceSnapshot >= (this.options.snapshotInterval ?? 64)
      ? this.compactExclusive()
      : Promise.resolve();
  }

  private async compactExclusive(): Promise<void> {
    await this.options.documents.writeSnapshot(
      FACT_AUTHORITY_DOCUMENT_ID,
      this.doc.export({ mode: "snapshot" }),
    );
    this.updatesSinceSnapshot = 0;
  }

  private async adoptDurableAuthorityAfterUnknown(): Promise<void> {
    try {
      const before = this.admission();
      const loaded = await loadAuthorityDocument(
        this.options.documents,
        FACT_AUTHORITY_DOCUMENT_ID,
        this.options.loroPeerId,
      );
      this.doc = loaded.doc;
      this.updatesSinceSnapshot = loaded.updateCount;
      this.cache.refresh(readAuthorityRecords(loaded.doc));
      if (this.admission().kind === "ready") {
        addFactsToSyncProjection(this.syncProjection, this.admission().snapshot.facts);
      }
      notifyAdmissionAdvance(before, this.admission(), this.options.onAuthorityAdvanced);
    } catch {
      // The caller retains outcome-unknown when durable authority cannot be audited.
    }
  }
}
