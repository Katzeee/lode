import type { FactFrontier, FactSnapshot, InvocationId, ReplicaId, WorkspaceId } from "../fact/index.js";

export type HardDeleteSelection = Readonly<{
  workspaceId: WorkspaceId;
  frontier: FactFrontier;
  nodeId: string;
  deletionFactIds: readonly string[];
  acknowledgementFactIds: readonly string[];
  retiredReplicaIds: readonly string[];
}>;

export type HardDeleteBlocker =
  | "already-purged"
  | "not-in-trash"
  | "owned-descendants"
  | "pending-proposal"
  | "replica-unconfirmed"
  | "outcome-unknown";

export type HardDeleteEvidence = Readonly<{
  workspaceId: WorkspaceId;
  nodeId: string;
  snapshot: FactSnapshot;
  localReplicaId: ReplicaId;
  ownedDescendantNodeIds: readonly string[];
  outcomeUnknownInvocationIds: readonly InvocationId[];
}>;

export type HardDeleteAssessment = Readonly<{
  selection: HardDeleteSelection;
  referenceOccurrenceIds: readonly string[];
  supertagApplicationNodeIds: readonly string[];
  materializedFieldNodeIds: readonly string[];
  ownedDescendantNodeIds: readonly string[];
  pendingProposalContributionIds: readonly string[];
  knownReplicaIds: readonly string[];
  acknowledgedReplicaIds: readonly string[];
  outcomeUnknownInvocationIds: readonly string[];
  blockers: readonly HardDeleteBlocker[];
  canExecute: boolean;
}>;
