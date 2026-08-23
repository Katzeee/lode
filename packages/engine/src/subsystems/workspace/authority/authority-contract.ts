import type {
  AuthorityReceipt,
  Fact,
  FactFrontier,
  FactId,
  FactActionId,
  FactSnapshot,
  FactBody,
  HistoryChannelId,
  InvocationId,
  ReplicaId,
} from "../../../domain/fact/index.js";
import type { SyncableDoc } from "../replica-sync.js";

export type AuthorityCommit = Readonly<{
  invocationId: InvocationId;
  request: unknown;
  writes: readonly FactBody[];
  lineage: AuthorityReceipt["lineage"];
  inverse: AuthorityReceipt["inverse"];
  publishedFrontier: FactFrontier;
}>;

export type AuthorityCommitResult = Readonly<{
  receipt: AuthorityReceipt;
  created: boolean;
}>;

export type FactAuthorityPort = {
  readonly replicaId: ReplicaId;
  snapshot(): FactSnapshot;
  receipt(invocationId: InvocationId): AuthorityReceipt | null;
  receipts(): readonly AuthorityReceipt[];
  receiptsForChannel(channelId: HistoryChannelId): readonly AuthorityReceipt[];
  facts(factIds: readonly FactId[]): readonly Fact[];
  factsOwningActions(actionIds: readonly FactActionId[]): readonly Fact[];
  relatedFacts(factIds: readonly FactId[]): readonly Fact[];
  relatedFactsOwningActions(actionIds: readonly FactActionId[]): readonly Fact[];
  historyImpacts(nodeId: string): readonly Readonly<{ channelId: string; invocationId: string }>[];
  commit(input: AuthorityCommit): Promise<AuthorityCommitResult>;
};

export type ReplicatedFactAuthorityPort = FactAuthorityPort & Readonly<{ replication: SyncableDoc }>;
