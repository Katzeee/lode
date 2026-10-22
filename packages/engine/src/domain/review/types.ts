import type {
  FactActionId,
  FactFrontier,
  PreviousValue,
  IntrinsicNodeType,
  ResolutionBody,
  SequenceAnchor,
  TextAtomId,
  ViewOptionsSpec,
  ViewType,
  FieldInitializationExpression,
  SearchClause,
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

type StructureDecisionEffect = Readonly<{
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

type LifecycleDecisionEffect = Readonly<{
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

type IntrinsicNodeTypeDecisionEffect = Readonly<{
  kind: "intrinsic-node-type";
  identity: string;
  origin: IntrinsicNodeType | null;
  review: IntrinsicNodeType | null;
}>;

export type SupertagRelationDecisionEffect = Readonly<{
  kind: "supertag-relation";
  relation:
    | "application"
    | "extension"
    | "template-node"
    | "template-field"
    | "template-field-visibility"
    | "template-field-static-default"
    | "optional-field";
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
  attachmentNodeId: string;
  attachmentOccurrenceId: string;
  viewType: ViewType;
  options: ViewOptionsSpec;
  optionsConflicted: boolean;
}>;

export type ViewDefinitionDecisionEffect = Readonly<{
  kind: "view-definition";
  viewId: FactActionId;
  origin: ViewDefinitionDecisionState | null;
  review: ViewDefinitionDecisionState | null;
}>;

export type SearchExpressionDecisionState = Readonly<{
  present: boolean;
  hostId: string | null;
  parentExpressionId: FactActionId | null;
  anchor: SequenceAnchor | null;
  clause: SearchClause | null;
}>;

export type SearchExpressionDecisionEffect = Readonly<{
  kind: "search-expression";
  expressionId: FactActionId;
  origin: SearchExpressionDecisionState | null;
  review: SearchExpressionDecisionState | null;
}>;

export type FieldDefinitionConfigurationDecisionState =
  | Readonly<{ kind: "datatype"; datatypeNodeId: string }>
  | Readonly<{ kind: "cardinality"; cardinalityNodeId: string }>
  | Readonly<{ kind: "optionality"; optionalityNodeId: string }>
  | Readonly<{ kind: "initialization-expression"; expression: FieldInitializationExpression }>;

export type FieldDefinitionConfigurationDecisionEffect = Readonly<{
  kind: "field-definition-configuration";
  fieldDefinitionId: string;
  configurationKind: FieldDefinitionConfigurationDecisionState["kind"];
  origin: FieldDefinitionConfigurationDecisionState | null;
  review: FieldDefinitionConfigurationDecisionState | null;
}>;

export type DecisionEffect =
  | TextDecisionEffect
  | StructureDecisionEffect
  | LifecycleDecisionEffect
  | OwnerDecisionEffect
  | IntrinsicNodeTypeDecisionEffect
  | SupertagRelationDecisionEffect
  | FieldMaterializationDecisionEffect
  | InlineReferenceDecisionEffect
  | SearchExpressionDecisionEffect
  | ViewDefinitionDecisionEffect
  | FieldDefinitionConfigurationDecisionEffect;

export type DecisionEvidence = Readonly<{
  proposalActionIds: readonly FactActionId[];
  effects: readonly DecisionEffect[];
  associatedImpactIds: readonly string[];
}>;

export type ReviewSelection = Readonly<{
  evidenceId: string;
  proposalActionIds: readonly FactActionId[];
}>;

export type ReviewEvidence = Readonly<{
  effects: readonly DecisionEffect[];
  associatedImpactIds: readonly string[];
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
      | "materialized-field"
      | "inline-reference"
      | "search-expression"
      | "view-definition"
      | "field-definition-configuration";
    identity: string;
  }>;
  neutralBridgeAtomIds: readonly TextAtomId[];
  linkedHunkIds: readonly string[];
  evidence: ReviewEvidence;
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
