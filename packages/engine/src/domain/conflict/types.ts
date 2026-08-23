import type {
  FactActionId,
  FactFrontier,
  FactId,
  ResolutionDecision,
  ResolutionId,
  SequenceAnchor,
  IntrinsicNodeType,
  AuthoredAction,
} from "../fact/index.js";

type ResolutionConflictCandidate = Readonly<{
  resolutionId: ResolutionId;
  decision: ResolutionDecision;
  actorId: string;
  replicaId: string;
  observedFrontier: FactFrontier;
}>;

export type ConflictIssue =
  | Readonly<{
      kind: "unsupported-direct-intent";
      identity: string;
      factActionId: FactActionId;
      actionKind: AuthoredAction["kind"];
      actorId: string;
      replicaId: string;
      observedFrontier: FactFrontier;
      missingSupportActionIds: readonly FactActionId[];
      requiredNodeIds: readonly string[];
      recoveryActions: readonly ["restore-support"];
    }>
  | Readonly<{
      kind: "intrinsic-node-type-conflict";
      identity: string;
      nodeId: string;
      candidates: readonly Readonly<{
        factActionId: FactActionId;
        intrinsicNodeType: IntrinsicNodeType;
        actorId: string;
        replicaId: string;
        observedFrontier: FactFrontier;
      }>[];
    }>
  | Readonly<{
      kind: "resolution-conflict";
      identity: string;
      proposalFactIds: readonly FactId[];
      candidates: readonly ResolutionConflictCandidate[];
    }>
  | Readonly<{
      kind: "placement-conflict";
      identity: string;
      occurrenceId: string;
      canonicalParentNodeId: string;
      candidates: readonly Readonly<{
        factActionId: FactActionId;
        parentNodeId: string;
        anchor: SequenceAnchor;
        actorId: string;
        replicaId: string;
        observedFrontier: FactFrontier;
      }>[];
    }>
  | Readonly<{
      kind: "original-conflict";
      identity: string;
      nodeId: string;
      canonicalPlacementId: string;
      candidates: readonly Readonly<{
        factActionId: FactActionId;
        placementId: string;
        actorId: string;
        replicaId: string;
        observedFrontier: FactFrontier;
      }>[];
    }>
  | Readonly<{
      kind: "supertag-extension-cycle";
      identity: string;
      supertagIds: readonly string[];
    }>;

export type ConflictQuery = Readonly<{
  generationId: string;
  frontier: FactFrontier;
  issues: readonly ConflictIssue[];
  next: string | null;
}>;
