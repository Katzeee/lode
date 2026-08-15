import type {
  FactFrontier,
  FieldTemplateConfig,
  FieldValueSeed,
  ResolutionDecision,
  SequenceAnchor,
  NodeType,
  Mutation,
} from "../fact/index.js";

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
      kind: "node-type-conflict";
      identity: string;
      nodeId: string;
      candidates: readonly Readonly<{
        contributionId: string;
        nodeType: NodeType;
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
      kind: "schema-extension-cycle";
      identity: string;
      schemaIds: readonly string[];
    }>
  | Readonly<{
      kind: "field-config-conflict";
      identity: string;
      ownerNodeId: string | null;
      fieldDefinitionId: string;
      schemaIds: readonly string[];
      templateOccurrenceIds: readonly string[];
      candidates: readonly Readonly<{
        config: FieldTemplateConfig;
        contributionIds: readonly string[];
      }>[];
    }>
  | Readonly<{
      kind: "field-initialization-conflict";
      identity: string;
      ownerNodeId: string;
      fieldDefinitionId: string;
      candidates: readonly Readonly<{
        initializationId: string;
        schemaId: string;
        source: "static-default" | "auto-initialize";
        values: readonly FieldValueSeed[];
      }>[];
    }>;

export type ConflictQuery = Readonly<{
  generationId: string;
  frontier: FactFrontier;
  issues: readonly ConflictIssue[];
  next: string | null;
}>;
