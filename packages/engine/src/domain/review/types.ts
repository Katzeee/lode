import type {
  ContributionId,
  FactFrontier,
  FieldTemplateConfig,
  PreviousValue,
  NodeType,
  ResolutionBody,
  SequenceAnchor,
  TextAtomId,
} from "../fact/index.js";

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
  targetKind: "node" | "occurrence";
  targetId: string;
  namespace: "property" | "metadata" | "schema";
  key: string;
  origin: PreviousValue;
  review: PreviousValue;
}>;

export type LifecycleDecisionEffect = Readonly<{
  kind: "lifecycle";
  identity: string;
  origin: boolean | null;
  review: boolean | null;
}>;

export type OwnerDecisionEffect = Readonly<{
  kind: "owner";
  identity: string;
  origin: string | null;
  review: string | null;
}>;

export type NodeTypeDecisionEffect = Readonly<{
  kind: "node-type";
  identity: string;
  origin: NodeType | null;
  review: NodeType | null;
}>;

export type SchemaRelationDecisionEffect = Readonly<{
  kind: "schema-relation";
  relation: "application" | "field" | "extension" | "template-node";
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

export type FieldConfigurationDecisionEffect = Readonly<{
  kind: "field-configuration";
  schemaId: string;
  fieldDefinitionId: string;
  origin: FieldTemplateConfig | null;
  review: FieldTemplateConfig | null;
}>;

export type DecisionEffect =
  | TextDecisionEffect
  | StructureDecisionEffect
  | ValueDecisionEffect
  | LifecycleDecisionEffect
  | OwnerDecisionEffect
  | NodeTypeDecisionEffect
  | SchemaRelationDecisionEffect
  | FieldConfigurationDecisionEffect
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
}>;

export type ReviewHunk = Readonly<{
  id: string;
  diffSpace: Readonly<{
    kind:
      | "node-content"
      | "child-sequence"
      | "value"
      | "lifecycle"
      | "owner"
      | "schema-application"
      | "schema-template"
      | "field-configuration"
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
