import type {
  AuthorityReceipt,
  Fact,
  FactFrontier,
  FactId,
  FactActionId,
  FactSnapshot,
  FactBody,
  InvocationId,
  ReplicaId,
} from "../../../domain/fact/index.js";
import type { SyncableDoc } from "./replication.js";

export type AuthorityCommit = Readonly<{
  invocationId: InvocationId;
  request: unknown;
  writes: readonly FactBody[];
  lineage: AuthorityReceipt["lineage"];
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
  facts(factIds: readonly FactId[]): readonly Fact[];
  factsOwningActions(actionIds: readonly FactActionId[]): readonly Fact[];
  relatedFacts(factIds: readonly FactId[]): readonly Fact[];
  relatedFactsOwningActions(actionIds: readonly FactActionId[]): readonly Fact[];
  commit(input: AuthorityCommit): Promise<AuthorityCommitResult>;
};

export type ReplicatedFactAuthorityPort = FactAuthorityPort & Readonly<{ replication: SyncableDoc }>;
