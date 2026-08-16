import type {
  ContributionId,
  FactFrontier,
  SupertagFieldConfig,
  PreviousValue,
  NodeType,
  ResolutionBody,
  SequenceAnchor,
  TextAtomId,
  ViewType,
  FieldCardinality,
  FieldDatatype,
  FieldInitializationExpression,
} from "../fact/index.js";
import type { InlineReferenceTargetStatus } from "../reconcile/index.js";

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

export type SupertagRelationDecisionEffect = Readonly<{
  kind: "supertag-relation";
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
  supertagId: string;
  fieldDefinitionId: string;
  origin: SupertagFieldConfig | null;
  review: SupertagFieldConfig | null;
}>;

export type InlineReferenceDecisionState = Readonly<{
  hostNodeId: string;
  targetNodeId: string;
  aliasNodeId: string | null;
  targetStatus: InlineReferenceTargetStatus;
  anchor: SequenceAnchor;
}>;

export type InlineReferenceDecisionEffect = Readonly<{
  kind: "inline-reference";
  inlineReferenceId: string;
  origin: InlineReferenceDecisionState | null;
  review: InlineReferenceDecisionState | null;
}>;

export type ViewDefinitionDecisionState = Readonly<{
  hostNodeId: string;
  viewType: ViewType;
}>;

export type ViewDefinitionDecisionEffect = Readonly<{
  kind: "view-definition";
  viewDefinitionNodeId: string;
  origin: ViewDefinitionDecisionState | null;
  review: ViewDefinitionDecisionState | null;
}>;

export type FieldDefinitionConfigurationDecisionState =
  | Readonly<{ kind: "datatype"; datatype: FieldDatatype }>
  | Readonly<{ kind: "cardinality"; cardinality: FieldCardinality }>
  | Readonly<{ kind: "initialization-expression"; expression: FieldInitializationExpression }>;

export type FieldDefinitionConfigurationDecisionEffect = Readonly<{
  kind: "field-definition-configuration";
  fieldDefinitionId: string;
  configurationNodeId: string;
  origin: FieldDefinitionConfigurationDecisionState | null;
  review: FieldDefinitionConfigurationDecisionState | null;
}>;

export type DecisionEffect =
  | TextDecisionEffect
  | StructureDecisionEffect
  | LifecycleDecisionEffect
  | OwnerDecisionEffect
  | NodeTypeDecisionEffect
  | SupertagRelationDecisionEffect
  | FieldConfigurationDecisionEffect
  | FieldMaterializationDecisionEffect
  | InlineReferenceDecisionEffect
  | ViewDefinitionDecisionEffect
  | FieldDefinitionConfigurationDecisionEffect;

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
      | "lifecycle"
      | "owner"
      | "supertag-application"
      | "supertag-template"
      | "field-configuration"
      | "materialized-field"
      | "inline-reference"
      | "view-definition"
      | "field-definition-configuration";
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
