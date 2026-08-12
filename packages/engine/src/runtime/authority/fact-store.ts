import type {
  Admission,
  AuthorityReceipt,
  FactBody,
  FactFrontier,
  FactSnapshot,
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
  commit(input: AuthorityCommit): Promise<AuthorityCommitResult>;
  recoverToLastValidPrefix(): Promise<FactSnapshot>;
  compact(): Promise<void>;
};
