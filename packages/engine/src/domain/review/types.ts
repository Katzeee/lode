import type {
  ContributionId,
  FactFrontier,
  PreviousValue,
  ResolutionBody,
  SequenceAnchor,
  TextAtomId,
} from "../fact/index.js";

declare const REVIEW_SELECTION: unique symbol;

export type TextDecisionEffect = Readonly<{
  kind: "text";
  nodeId: string;
  addedAtomIds: readonly TextAtomId[];
  deletedAtomIds: readonly TextAtomId[];
  markChanges: readonly Readonly<{
    atomId: TextAtomId;
    key: string;
    origin: PreviousValue;
    review: PreviousValue;
  }>[];
}>;

export type StructureDecisionEffect = Readonly<{
  kind: "structure";
  occurrenceId: string;
  originPresent: boolean;
  reviewPresent: boolean;
  originParentId: string | null;
  reviewParentId: string | null;
  anchor: SequenceAnchor | null;
  originRelation: PlacementRelation | null;
  reviewRelation: PlacementRelation | null;
}>;

export type PlacementRelation = Readonly<{
  parentMatches: boolean;
  afterEndpoint: "before" | "after" | "missing" | null;
  beforeEndpoint: "before" | "after" | "missing" | null;
}>;

export type ValueDecisionEffect = Readonly<{
  kind: "value";
  ownerKind: "node" | "occurrence" | "schema" | "field";
  ownerId: string;
  namespace: "property" | "metadata" | "schema";
  key: string;
  origin: PreviousValue;
  review: PreviousValue;
}>;

export type LifecycleDecisionEffect = Readonly<{
  kind: "lifecycle" | "canonical";
  identity: string;
  origin: string | boolean | null;
  review: string | boolean | null;
}>;

export type SchemaRelationDecisionEffect = Readonly<{
  kind: "schema-relation";
  relation: "application" | "field" | "extension";
  ownerId: string;
  targetId: string;
  originIndex: number | null;
  reviewIndex: number | null;
}>;

export type FieldMaterializationDecisionEffect = Readonly<{
  kind: "field-materialization";
  ownerNodeId: string;
  fieldDefinitionId: string;
  originFieldNodeId: string | null;
  reviewFieldNodeId: string | null;
  originFieldOccurrenceId: string | null;
  reviewFieldOccurrenceId: string | null;
}>;

export type DecisionEffect =
  | TextDecisionEffect
  | StructureDecisionEffect
  | ValueDecisionEffect
  | LifecycleDecisionEffect
  | SchemaRelationDecisionEffect
  | FieldMaterializationDecisionEffect;

export type DecisionEvidence = Readonly<{
  proposalTargets: readonly ContributionId[];
  supportClosure: readonly ContributionId[];
  effects: readonly DecisionEffect[];
  associatedImpactIds: readonly string[];
  rulesVersion: string;
  schemaVersion: string;
}>;

export type ReviewSelection = Readonly<{
  token: string;
  workspaceId: string;
  frontier: FactFrontier;
  generationId: string;
  evidence: DecisionEvidence;
  [REVIEW_SELECTION]: true;
}>;

export type ReviewHunk = Readonly<{
  id: string;
  diffSpace: Readonly<{
    kind:
      | "node-content"
      | "child-sequence"
      | "value"
      | "lifecycle"
      | "canonical"
      | "schema-application"
      | "schema-template"
      | "materialized-field";
    identity: string;
  }>;
  proposalContributionIds: readonly ContributionId[];
  neutralBridgeAtomIds: readonly TextAtomId[];
  linkedHunkIds: readonly string[];
  selection: ReviewSelection;
}>;

export type ReviewQuery = Readonly<{
  generationId: string;
  frontier: FactFrontier;
  hunks: readonly ReviewHunk[];
  next: string | null;
}>;

export type SelectionValidation =
  | Readonly<{ kind: "valid"; resolution: ResolutionBody }>
  | Readonly<{ kind: "stale"; currentGenerationId: string; reason: string }>;
