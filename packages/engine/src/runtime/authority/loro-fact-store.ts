import type { LoroDoc } from "loro-crdt";

import {
  admitPlannedAuthorityAppend,
  admitAuthorityRecordShapes,
  canonicalDigest,
  canonicalJson,
  frontierEquals,
  requestDigest,
  stableStringCompare,
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
  deriveAuthorityCaches,
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

export { createReplicaId } from "./replica-identity.js";
export { FACT_AUTHORITY_DOCUMENT_ID } from "./loro-fact-store-options.js";

export class LoroFactStore implements FactStore {
  readonly syncDoc: SyncableDoc;
  private doc: LoroDoc;
  private syncProjection: LoroDoc;
  private readonly serial = new SerialExecutor();
  private updatesSinceSnapshot: number;
  private cachedRecords: readonly unknown[] = [];
  private cachedParsedRecords: readonly AuthorityRecord[] = [];
  private cachedAdmission!: Admission;
  private cachedReceipts = new Map<InvocationId, AuthorityReceipt>();
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
    this.refreshCaches(readAuthorityRecords(doc));
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

  admission(): Admission {
    return this.cachedAdmission;
  }

  snapshot() {
    const admission = this.admission();
    if (admission.kind === "fault") {
      throw new AuthorityFaultError(admission.fault ?? "Authority admission fault");
    }
    return admission.snapshot;
  }

  receipt(invocationId: InvocationId): AuthorityReceipt | null {
    return this.cachedReceipts.get(invocationId) ?? null;
  }

  receipts(): readonly AuthorityReceipt[] {
    return [...this.cachedReceipts.values()].sort(
      (left, right) =>
        (left.lineage?.ordinal ?? Number.MAX_SAFE_INTEGER) -
          (right.lineage?.ordinal ?? Number.MAX_SAFE_INTEGER) ||
        stableStringCompare(left.invocationId, right.invocationId),
    );
  }

  recoverToLastValidPrefix(): Promise<FactSnapshot> {
    return this.serial.run(() => this.recoverExclusive());
  }

  compact(): Promise<void> {
    return this.serial.run(() => this.compactExclusive());
  }

  async commit(input: AuthorityCommit): Promise<AuthorityCommitResult> {
    return this.serial.run(() => this.commitExclusive(input));
  }

  private async commitExclusive(input: AuthorityCommit): Promise<AuthorityCommitResult> {
    const digest = requestDigest(input.request);
    const existing = this.receipt(input.invocationId);
    if (existing) {
      if (existing.requestDigest !== digest) {
        throw new InvocationConflictError(`Invocation request conflict: ${input.invocationId}`);
      }
      await healFactSyncProjection(this.options.documents, this.syncProjection, this.admission());
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
    );
    const candidate = admitPlannedAuthorityAppend(
      this.options.workspaceId,
      before.snapshot,
      this.cachedParsedRecords,
      records,
    );
    if (candidate.kind !== "ready") {
      throw new Error(candidate.fault ?? "Local Fact batch did not admit completely");
    }
    try {
      await this.appendRecords(records, candidate, false);
    } catch (error) {
      await this.adoptDurableAuthorityAfterUnknown();
      throw new AuthorityCommitUnknownError(input.invocationId, { cause: error });
    }
    addFactsToSyncProjection(this.syncProjection, facts);
    try {
      await persistSyncProjection(this.options.documents, this.syncProjection);
      await this.compactIfNeeded();
    } catch (error) {
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
    this.refreshCaches([...this.cachedRecords, ...records], admitted);
    this.updatesSinceSnapshot += 1;
    if (compact) {
      await this.compactIfNeeded();
    }
    notifyAdmissionAdvance(before, this.cachedAdmission, this.options.onAuthorityAdvanced);
  }

  private async importUpdate(bytes: SyncBytes): Promise<void> {
    return this.serial.run(() => this.importUpdateExclusive(bytes));
  }

  private async importUpdateExclusive(bytes: SyncBytes): Promise<void> {
    const before = this.admission();
    if (before.kind === "fault") {
      throw new AuthorityFaultError(before.fault ?? "Authority admission fault");
    }
    const authorityRecords = this.cachedRecords;
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
    this.refreshCaches(readAuthorityRecords(this.doc));
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
      this.refreshCaches(readAuthorityRecords(loaded.doc));
      if (this.cachedAdmission.kind === "ready") {
        addFactsToSyncProjection(this.syncProjection, this.cachedAdmission.snapshot.facts);
      }
      notifyAdmissionAdvance(before, this.cachedAdmission, this.options.onAuthorityAdvanced);
    } catch {
      // The caller retains outcome-unknown when durable authority cannot be audited.
    }
  }
  private refreshCaches(records: readonly unknown[], admitted?: Admission): void {
    this.cachedRecords = records;
    const caches = deriveAuthorityCaches(
      this.options.workspaceId,
      this.replicaId,
      records,
      this.admitRecords,
      admitted,
    );
    this.cachedAdmission = caches.admission;
    this.cachedParsedRecords = caches.parsedRecords;
    this.cachedReceipts = new Map(caches.receipts);
  }
}
