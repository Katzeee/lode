import type { FactFrontier, ResolutionDecision, SequenceAnchor, IntrinsicNodeType, Mutation } from "../fact/index.js";

export type ResolutionConflictCandidate = Readonly<{
  resolutionId: string;
  decision: ResolutionDecision;
  actorId: string;
  replicaId: string;
  observedFrontier: FactFrontier;
}>;

export type ConflictIssue =
  | Readonly<{
      kind: "unsupported-direct-intent";
      identity: string;
      contributionId: string;
      mutationKind: Mutation["kind"];
      actorId: string;
      replicaId: string;
      observedFrontier: FactFrontier;
      missingSupportContributionIds: readonly string[];
      requiredNodeIds: readonly string[];
      recoveryActions: readonly ["restore-support"];
    }>
  | Readonly<{
      kind: "intrinsic-node-type-conflict";
      identity: string;
      nodeId: string;
      candidates: readonly Readonly<{
        contributionId: string;
        intrinsicNodeType: IntrinsicNodeType;
        actorId: string;
        replicaId: string;
        observedFrontier: FactFrontier;
      }>[];
    }>
  | Readonly<{
      kind: "resolution-conflict";
      identity: string;
      proposalContributionIds: readonly string[];
      candidates: readonly ResolutionConflictCandidate[];
    }>
  | Readonly<{
      kind: "placement-conflict";
      identity: string;
      occurrenceId: string;
      canonicalParentNodeId: string;
      candidates: readonly Readonly<{
        contributionId: string;
        parentNodeId: string;
        anchor: SequenceAnchor;
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
