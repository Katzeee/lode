import type { FactActionId, FactFrontier, FactId, FactSnapshot, ReplicaId, WorkspaceId } from "../fact/index.js";

export type HardDeleteSelection = Readonly<{
  workspaceId: WorkspaceId;
  frontier: FactFrontier;
  nodeId: string;
  deletionActionIds: readonly FactActionId[];
  acknowledgementFactIds: readonly FactId[];
  retiredReplicaIds: readonly string[];
}>;

export type HardDeleteBlocker =
  "already-purged" | "not-in-trash" | "owned-descendants" | "pending-proposal" | "replica-unconfirmed";

export type HardDeleteEvidence = Readonly<{
  workspaceId: WorkspaceId;
  nodeId: string;
  snapshot: FactSnapshot;
  localReplicaId: ReplicaId;
  ownedDescendantNodeIds: readonly string[];
}>;

export type HardDeleteAssessment = Readonly<{
  selection: HardDeleteSelection;
  referenceOccurrenceIds: readonly string[];
  supertagApplicationNodeIds: readonly string[];
  materializedFieldNodeIds: readonly string[];
  ownedDescendantNodeIds: readonly string[];
  pendingProposalActionIds: readonly FactActionId[];
  knownReplicaIds: readonly string[];
  acknowledgedReplicaIds: readonly string[];
  blockers: readonly HardDeleteBlocker[];
  canExecute: boolean;
}>;
