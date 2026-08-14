import type {
  Admission,
  AuthorityReceipt,
  Fact,
  FactFrontier,
  FactSnapshot,
  FactWrite,
  HistoryChannelId,
  InvocationId,
  ReplicaId,
  WorkspaceId,
} from "../../domain/fact/index.js";

export type AuthorityCommit = Readonly<{
  invocationId: InvocationId;
  request: unknown;
  writes: readonly FactWrite[];
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

export type FactAuthority = {
  readonly replicaId: ReplicaId;
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
