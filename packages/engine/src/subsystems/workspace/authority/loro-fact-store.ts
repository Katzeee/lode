import { LoroDoc, VersionVector } from "loro-crdt";

import {
  factId,
  normalizeFrontier,
  parseFactBody,
  type Fact,
  type FactActionId,
  type FactId,
  type FactFrontier,
  type FactSnapshot,
  type FactBody,
  type WorkspaceId,
} from "../../../domain/fact/index.js";
import type { DocumentStore, DocumentUpdate } from "../../persistence/index.js";
import type { SyncBytes, SyncableDoc } from "../replica-sync.js";
import { FactStoreCache } from "./fact-store-cache.js";

export const FACT_AUTHORITY_DOCUMENT_ID = "facts";
const FACT_LIST_ID = "facts";

type LoroFactStoreOptions = Readonly<{
  workspaceId: WorkspaceId;
  loroPeerId: `${number}`;
  documents: DocumentStore;
  snapshotInterval?: number;
}>;

export class LoroFactStore {
  readonly replication: SyncableDoc;
  private readonly cache: FactStoreCache;

  private constructor(
    private readonly options: LoroFactStoreOptions,
    private document: LoroDoc,
    private updatesSinceSnapshot: number,
    private pending: readonly PendingFactSpan[],
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
    const document = createDocument(options.loroPeerId);
    const loaded = await options.documents.load(FACT_AUTHORITY_DOCUMENT_ID);
    let pending: readonly PendingFactSpan[] = [];
    if (loaded?.snapshot) {
      pending = updatePendingSpans(pending, document.import(loaded.snapshot), document.oplogVersion());
    }
    for (const bytes of loaded?.updates ?? []) {
      pending = updatePendingSpans(pending, document.import(bytes), document.oplogVersion());
    }
    return new LoroFactStore(options, document, loaded?.updates.length ?? 0, pending);
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
    await this.options.documents.appendUpdate(FACT_AUTHORITY_DOCUMENT_ID, bytes);
    const imported = importFactRecords(this.document, this.options.workspaceId, bytes);
    const facts = imported.facts;
    const snapshot = this.cache.previewAppend(facts, versionFrontier(this.document.version()));
    this.cache.append(facts, snapshot);
    this.pending = updatePendingSpans(this.pending, imported.status, this.document.oplogVersion());
    this.updatesSinceSnapshot += 1;
    await this.compactIfNeeded();
  }

  private async compactIfNeeded(): Promise<void> {
    if (this.pending.length > 0 || this.updatesSinceSnapshot < (this.options.snapshotInterval ?? 64)) {
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

function createDocument(peerId: `${number}`): LoroDoc {
  const document = new LoroDoc();
  document.setPeerId(peerId);
  document.setChangeMergeInterval(-1);
  document.getList(FACT_LIST_ID);
  return document;
}

function appendFactRecords(
  document: LoroDoc,
  workspaceId: WorkspaceId,
  bodies: readonly FactBody[],
  firstSequence: number,
): readonly Fact[] {
  const list = document.getList(FACT_LIST_ID);
  const facts: Fact[] = [];
  let factSequence = firstSequence;
  for (const body of bodies) {
    list.push(body);
    document.commit({ message: `fact/${document.peerIdStr}/${factSequence}` });
    facts.push(readFactAt(document, workspaceId, list.length - 1));
    factSequence += 1;
  }
  return facts;
}

function readFactState(document: LoroDoc, workspaceId: WorkspaceId): LoroFactState {
  const list = document.getList(FACT_LIST_ID);
  const facts: Fact[] = [];

  for (let index = 0; index < list.length; index += 1) {
    facts.push(readFactAt(document, workspaceId, index));
  }

  return {
    facts,
    frontier: versionFrontier(document.version()),
  };
}

function importFactRecords(
  document: LoroDoc,
  workspaceId: WorkspaceId,
  bytes: SyncBytes,
): Readonly<{ facts: readonly Fact[]; status: ReturnType<LoroDoc["import"]> }> {
  const list = document.getList(FACT_LIST_ID);
  const facts: Fact[] = [];
  let importError: Error | undefined;
  const unsubscribe = list.subscribe((batch) => {
    try {
      for (const event of batch.events) {
        if (event.target !== `cid:root-${FACT_LIST_ID}:List` || event.diff.type !== "list") {
          throw new Error("Fact authority import changed a non-Fact container");
        }
        let index = 0;
        for (const delta of event.diff.diff) {
          if (delta.retain !== undefined) {
            index += delta.retain;
          } else if (delta.delete !== undefined) {
            throw new Error("Fact authority updates cannot remove an existing Fact");
          } else {
            for (let offset = 0; offset < delta.insert.length; offset += 1) {
              facts.push(readFactAt(document, workspaceId, index + offset));
            }
            index += delta.insert.length;
          }
        }
      }
    } catch (error) {
      importError = error instanceof Error ? error : new Error(String(error));
    }
  });
  let status: ReturnType<LoroDoc["import"]>;
  try {
    status = document.import(bytes);
  } finally {
    unsubscribe();
  }
  if (importError !== undefined) {
    throw importError;
  }
  return { facts, status };
}

function readFactAt(document: LoroDoc, workspaceId: WorkspaceId, index: number): Fact {
  const list = document.getList(FACT_LIST_ID);
  return factFromRecord(document, workspaceId, changeAt(document, index), parseFactBody(list.get(index)));
}

function changeAt(document: LoroDoc, index: number): ReturnType<LoroDoc["getChangeAt"]> {
  const list = document.getList(FACT_LIST_ID);
  const cursor = list.getCursor(index, 0);
  try {
    const operationId = cursor?.pos();
    if (!operationId) {
      throw new Error(`Fact record has no Loro operation identity at index ${index}`);
    }
    const change = document.getChangeAt(operationId);
    if (change.length !== 1 || operationId.counter !== change.counter) {
      throw new Error(`One Fact record must occupy one complete Loro Change: ${change.peer}/${change.counter}`);
    }
    return change;
  } finally {
    cursor?.free();
  }
}

function factFromRecord(
  document: LoroDoc,
  workspaceId: WorkspaceId,
  change: ReturnType<LoroDoc["getChangeAt"]>,
  body: FactBody,
): Fact {
  const sequence = change.counter + 1;
  const baseObserved = new Map(document.frontiersToVV(change.deps).toJSON());
  return {
    id: factId(workspaceId, change.peer, sequence),
    coordinate: {
      dot: { replicaId: change.peer, sequence },
      observed: normalizeFrontier(Object.fromEntries(baseObserved)),
      lamport: change.lamport + 1,
    },
    body,
  };
}

function versionFrontier(version: VersionVector): FactFrontier {
  return normalizeFrontier(Object.fromEntries(version.toJSON()));
}

type LoroFactState = Readonly<{
  facts: readonly Fact[];
  frontier: FactFrontier;
}>;

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
