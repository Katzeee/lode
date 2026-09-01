import type { LoroDoc } from "loro-crdt";
import { VersionVector } from "loro-crdt";

import {
  type Fact,
  type FactActionId,
  type FactId,
  type FactSnapshot,
  type FactBody,
  type WorkspaceId,
} from "../../../domain/fact/index.js";
import type { DocumentStore, DocumentUpdate } from "../../persistence/index.js";
import type { SyncBytes, SyncableDoc } from "./replication.js";
import { FactStoreCache } from "./fact-store-cache.js";
import { AUTHORITY_SNAPSHOT_UPDATE_INTERVAL } from "./compaction-policy.js";
import {
  appendFactRecords,
  assertFactDocumentShape,
  createFactDocument,
  importFactRecords,
  readFactState,
  versionFrontier,
} from "./loro-fact-records.js";

const FACT_AUTHORITY_DOCUMENT_ID = "facts";

type LoroFactStoreOptions = Readonly<{
  workspaceId: WorkspaceId;
  loroPeerId: `${number}`;
  documents: DocumentStore;
}>;

export class LoroFactStore {
  readonly replication: SyncableDoc;
  private readonly cache: FactStoreCache;

  private constructor(
    private readonly options: LoroFactStoreOptions,
    private document: LoroDoc,
    private updatesSinceSnapshot: number,
    private pending: readonly PendingFactSpan[],
    private pendingUpdates: readonly SyncBytes[],
  ) {
    const state = readFactState(document, options.workspaceId);
    this.cache = new FactStoreCache(options.workspaceId);
    this.cache.refresh(state.facts, state.frontier);
    this.replication = {
      id: FACT_AUTHORITY_DOCUMENT_ID,
      version: () => Promise.resolve(this.document.version().encode()),
      exportUpdate: (from?: SyncBytes) =>
        Promise.resolve(
          this.document.export(from ? { mode: "update", from: VersionVector.decode(from) } : { mode: "update" }),
        ),
      importUpdate: (bytes) => this.importUpdate(bytes),
    };
  }

  static async open(options: LoroFactStoreOptions): Promise<LoroFactStore> {
    const document = createFactDocument(options.loroPeerId);
    const loaded = await options.documents.load(FACT_AUTHORITY_DOCUMENT_ID);
    let pending: readonly PendingFactSpan[] = [];
    let pendingUpdates: readonly SyncBytes[] = [];
    if (loaded?.snapshot) {
      pending = updatePendingSpans(pending, document.import(loaded.snapshot), document.oplogVersion());
    }
    for (const bytes of loaded?.updates ?? []) {
      pending = updatePendingSpans(pending, document.import(bytes), document.oplogVersion());
      pendingUpdates = pending.length > 0 ? [...pendingUpdates, bytes] : [];
    }
    assertFactDocumentShape(document);
    return new LoroFactStore(options, document, loaded?.updates.length ?? 0, pending, pendingUpdates);
  }

  snapshot(): FactSnapshot {
    return this.cache.snapshot();
  }

  allFacts(): readonly Fact[] {
    return this.cache.allFacts();
  }

  facts(factIds: readonly FactId[]): readonly Fact[] {
    return this.cache.facts(factIds);
  }

  factsOwningActions(actionIds: readonly FactActionId[]): readonly Fact[] {
    return this.cache.factsOwningActions(actionIds);
  }

  relatedFacts(factIds: readonly FactId[]): readonly Fact[] {
    return this.cache.relatedFacts(factIds);
  }

  relatedFactsOwningActions(actionIds: readonly FactActionId[]): readonly Fact[] {
    return this.cache.relatedFactsOwningActions(actionIds);
  }

  stageAppend(writes: readonly FactBody[]): StagedFactAppend {
    const before = this.document.version();
    const firstSequence = (before.get(this.options.loroPeerId) ?? 0) + 1;
    const staged = this.document.fork();
    staged.setPeerId(this.options.loroPeerId);
    staged.setChangeMergeInterval(-1);
    const facts = appendFactRecords(staged, this.options.workspaceId, writes, firstSequence);
    const snapshot = this.cache.previewAppend(facts, versionFrontier(staged.version()));
    const bytes = staged.export({ mode: "update", from: before });
    return {
      update: { id: FACT_AUTHORITY_DOCUMENT_ID, bytes },
      facts,
      snapshot,
      apply: () => {
        const status = this.document.import(bytes);
        this.pending = updatePendingSpans(this.pending, status, this.document.oplogVersion());
        this.cache.append(facts, snapshot);
        this.updatesSinceSnapshot += 1;
      },
      compact: () => this.compactIfNeeded(),
    };
  }

  private async importUpdate(bytes: SyncBytes): Promise<void> {
    const staged = this.document.fork();
    for (const pendingUpdate of this.pendingUpdates) {
      staged.import(pendingUpdate);
    }
    importFactRecords(staged, this.options.workspaceId, bytes);
    assertFactDocumentShape(staged);
    const stagedState = readFactState(staged, this.options.workspaceId);
    const existingFactIds = new Set(this.cache.allFacts().map((fact) => fact.id));
    const facts = stagedState.facts.filter((fact) => !existingFactIds.has(fact.id));
    const snapshot = this.cache.previewAppend(facts, stagedState.frontier);
    await this.options.documents.appendUpdate(FACT_AUTHORITY_DOCUMENT_ID, bytes);
    const imported = importFactRecords(this.document, this.options.workspaceId, bytes);
    this.cache.append(facts, snapshot);
    this.pending = updatePendingSpans(this.pending, imported.status, this.document.oplogVersion());
    this.pendingUpdates = this.pending.length > 0 ? [...this.pendingUpdates, bytes] : [];
    this.updatesSinceSnapshot += 1;
    await this.compactIfNeeded();
  }

  private async compactIfNeeded(): Promise<void> {
    if (this.pending.length > 0 || this.updatesSinceSnapshot < AUTHORITY_SNAPSHOT_UPDATE_INTERVAL) {
      return;
    }
    try {
      await this.options.documents.writeSnapshot(
        FACT_AUTHORITY_DOCUMENT_ID,
        this.document.export({ mode: "snapshot" }),
      );
      this.updatesSinceSnapshot = 0;
    } catch {
      // The durable update chain remains authoritative and the next append retries compaction.
    }
  }
}

type PendingFactSpan = Readonly<{ peer: `${number}`; end: number }>;

function updatePendingSpans(
  current: readonly PendingFactSpan[],
  status: ReturnType<LoroDoc["import"]>,
  version: VersionVector,
): readonly PendingFactSpan[] {
  const ends = new Map(current.map(({ peer, end }) => [peer, end]));
  for (const [peer, span] of status.pending ?? []) {
    ends.set(peer, Math.max(ends.get(peer) ?? 0, span.end));
  }
  return [...ends].filter(([peer, end]) => (version.get(peer) ?? 0) < end).map(([peer, end]) => ({ peer, end }));
}

type StagedFactAppend = Readonly<{
  update: DocumentUpdate;
  facts: readonly Fact[];
  snapshot: FactSnapshot;
  apply(): void;
  compact(): Promise<void>;
}>;
