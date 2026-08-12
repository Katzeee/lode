import type {
  Admission,
  AuthorityReceipt,
  FactBody,
  Fact,
  FactFrontier,
  FactSnapshot,
  HistoryChannelId,
  InvocationId,
  ReplicaId,
  WorkspaceId,
} from "../../domain/fact/index.js";
import type { SyncableDoc } from "../../sync/syncable.js";

export type AuthorityCommit = Readonly<{
  invocationId: InvocationId;
  request: unknown;
  bodies: readonly FactBody[];
  lineage: AuthorityReceipt["lineage"];
  publishedFrontier: FactFrontier;
}>;

export type AuthorityCommitResult = Readonly<{
  receipt: AuthorityReceipt;
  created: boolean;
}>;

export type AuthorityAdmissionPolicy = (
  workspaceId: WorkspaceId,
  records: readonly unknown[],
) => Admission;

export type FactStore = {
  readonly replicaId: ReplicaId;
  readonly syncDoc: SyncableDoc;
  admission(): Admission;
  snapshot(): FactSnapshot;
  receipt(invocationId: InvocationId): AuthorityReceipt | null;
  receipts(): readonly AuthorityReceipt[];
  receiptsForChannel(channelId: HistoryChannelId): readonly AuthorityReceipt[];
  facts(factIds: readonly string[]): readonly Fact[];
  relatedFacts(factIds: readonly string[]): readonly Fact[];
  occurrenceNodeId(occurrenceId: string): string | null;
  historyImpacts(nodeId: string): readonly Readonly<{ channelId: string; invocationId: string }>[];
  uncertainInvocations(): readonly InvocationId[];
  settleInvocation(invocationId: InvocationId): void;
  commit(input: AuthorityCommit): Promise<AuthorityCommitResult>;
  recoverToLastValidPrefix(): Promise<FactSnapshot>;
  compact(): Promise<void>;
};
