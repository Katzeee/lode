import {
  canonicalJson,
  parseAuthorityReceipt,
  stableStringCompare,
  validateReceipts,
  type AuthorityReceipt,
  type Fact,
  type FactId,
  type InvocationId,
  type ReplicaId,
  type WorkspaceId,
} from "../../../domain/fact/index.js";
import type { DocumentStore, DocumentUpdate } from "../../persistence/index.js";

export function localReceiptsDocumentId(replicaId: ReplicaId): string {
  return `receipts/${replicaId}`;
}

type LocalReceiptStoreOptions = Readonly<{
  workspaceId: WorkspaceId;
  replicaId: ReplicaId;
  documents: DocumentStore;
  snapshotInterval?: number;
}>;

export class LocalReceiptStore {
  private readonly byInvocation = new Map<InvocationId, AuthorityReceipt>();
  private readonly byChannel = new Map<string, AuthorityReceipt[]>();
  private readonly historyInvocationIdsByFact = new Map<string, Set<string>>();

  private constructor(
    private readonly options: LocalReceiptStoreOptions,
    receipts: readonly AuthorityReceipt[],
    private updatesSinceSnapshot: number,
  ) {
    receipts.forEach((receipt) => this.add(receipt));
  }

  static async open(options: LocalReceiptStoreOptions, facts: readonly Fact[]): Promise<LocalReceiptStore> {
    const loaded = await options.documents.load(localReceiptsDocumentId(options.replicaId));
    const receipts = [
      ...(loaded?.snapshot ? decodeReceiptSnapshot(loaded.snapshot) : []),
      ...(loaded?.updates.map(decodeReceipt) ?? []),
    ];
    if (receipts.some((receipt) => receipt.replicaId !== options.replicaId)) {
      throw new Error("Local receipt store contains a receipt from another Replica");
    }
    validateReceipts(options.workspaceId, receipts, facts);
    return new LocalReceiptStore(options, receipts, loaded?.updates.length ?? 0);
  }

  receipt(invocationId: InvocationId): AuthorityReceipt | null {
    return this.byInvocation.get(invocationId) ?? null;
  }

  receipts(): readonly AuthorityReceipt[] {
    return [...this.byInvocation.values()].sort(
      (left, right) =>
        (left.lineage?.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.lineage?.ordinal ?? Number.MAX_SAFE_INTEGER) ||
        stableStringCompare(left.invocationId, right.invocationId),
    );
  }

  receiptsForChannel(channelId: string): readonly AuthorityReceipt[] {
    return [...(this.byChannel.get(channelId) ?? [])];
  }

  lastReceiptForChannel(channelId: string): AuthorityReceipt | null {
    return this.byChannel.get(channelId)?.at(-1) ?? null;
  }

  historyImpacts(factIds: readonly FactId[]): readonly Readonly<{ channelId: string; invocationId: string }>[] {
    const invocationIds = new Set(
      factIds.flatMap((factId) => [...(this.historyInvocationIdsByFact.get(factId) ?? [])]),
    );
    return [...invocationIds]
      .flatMap((invocationId) => {
        const receipt = this.byInvocation.get(invocationId);
        return receipt?.lineage ? [{ channelId: receipt.lineage.channelId, invocationId }] : [];
      })
      .sort(
        (left, right) =>
          stableStringCompare(left.channelId, right.channelId) ||
          stableStringCompare(left.invocationId, right.invocationId),
      );
  }

  stageAppend(receipt: AuthorityReceipt): StagedReceiptAppend {
    return {
      update: { id: localReceiptsDocumentId(this.options.replicaId), bytes: encodeReceipt(receipt) },
      apply: () => {
        this.add(receipt);
        this.updatesSinceSnapshot += 1;
      },
      compact: () => this.compactIfNeeded(),
    };
  }

  private add(receipt: AuthorityReceipt): void {
    this.byInvocation.set(receipt.invocationId, receipt);
    const channelId = receipt.lineage?.channelId;
    if (!channelId) {
      return;
    }
    const channel = this.byChannel.get(channelId) ?? [];
    if (channel.some((candidate) => candidate.invocationId === receipt.invocationId)) {
      return;
    }
    channel.push(receipt);
    this.byChannel.set(channelId, channel);
    for (const factId of receipt.factIds) {
      const invocationIds = this.historyInvocationIdsByFact.get(factId) ?? new Set<string>();
      invocationIds.add(receipt.invocationId);
      this.historyInvocationIdsByFact.set(factId, invocationIds);
    }
  }

  private async compactIfNeeded(): Promise<void> {
    if (this.updatesSinceSnapshot < (this.options.snapshotInterval ?? 64)) {
      return;
    }
    try {
      await this.options.documents.writeSnapshot(
        localReceiptsDocumentId(this.options.replicaId),
        encodeReceiptSnapshot(this.receipts()),
      );
      this.updatesSinceSnapshot = 0;
    } catch {
      // The durable update chain remains complete and the next append retries compaction.
    }
  }
}

type StagedReceiptAppend = Readonly<{
  update: DocumentUpdate;
  apply(): void;
  compact(): Promise<void>;
}>;

function encodeReceipt(receipt: AuthorityReceipt): Uint8Array {
  return new TextEncoder().encode(canonicalJson(receipt));
}

function decodeReceipt(bytes: Uint8Array): AuthorityReceipt {
  return parseAuthorityReceipt(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
}

function encodeReceiptSnapshot(receipts: readonly AuthorityReceipt[]): Uint8Array {
  return new TextEncoder().encode(canonicalJson(receipts));
}

function decodeReceiptSnapshot(bytes: Uint8Array): AuthorityReceipt[] {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(value)) {
    throw new Error("Local receipt snapshot is malformed");
  }
  return value.map(parseAuthorityReceipt);
}
