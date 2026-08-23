import type {
  ConflictQueryResult as ProtocolConflictQuery,
  FieldMaterializationDecisionEffect as ProtocolFieldMaterializationDecisionEffect,
  LifecycleDecisionEffect as ProtocolLifecycleDecisionEffect,
  IntrinsicNodeTypeConflict as ProtocolIntrinsicNodeTypeConflict,
  IntrinsicNodeTypeDecisionEffect as ProtocolIntrinsicNodeTypeDecisionEffect,
  OwnerDecisionEffect as ProtocolOwnerDecisionEffect,
  PlacementConflict as ProtocolPlacementConflict,
  OriginalConflict as ProtocolOriginalConflict,
  PlacementRelation as ProtocolPlacementRelation,
  ResolutionConflict as ProtocolResolutionConflict,
  ResolutionConflictCandidate as ProtocolResolutionConflictCandidate,
  ReviewHunk as ProtocolReviewHunk,
  ReviewQueryResult as ProtocolReviewQuery,
  ReviewSelection as ProtocolReviewSelection,
  SupertagExtensionCycleConflict as ProtocolSupertagExtensionCycleConflict,
  SupertagRelationDecisionEffect as ProtocolSupertagRelationDecisionEffect,
  StructureDecisionEffect as ProtocolStructureDecisionEffect,
  TextDecisionEffect as ProtocolTextDecisionEffect,
  UnsupportedDirectIntentConflict as ProtocolUnsupportedDirectIntentConflict,
  InlineReferenceDecisionEffect as ProtocolInlineReferenceDecisionEffect,
  InlineReferenceDecisionState as ProtocolInlineReferenceDecisionState,
  ViewDefinitionDecisionEffect as ProtocolViewDefinitionDecisionEffect,
  ViewDefinitionDecisionState as ProtocolViewDefinitionDecisionState,
  FieldDefinitionConfigurationDecisionEffect as ProtocolFieldDefinitionConfigurationDecisionEffect,
  SearchExpressionDecisionEffect as ProtocolSearchExpressionDecisionEffect,
  SearchExpressionDecisionState as ProtocolSearchExpressionDecisionState,
} from "@lode/protocol/dto/review";
import type {
  IntrinsicNodeType,
  PreviousValue,
  ProtocolDto,
  ResolutionDecision,
  SequenceAnchor,
  TextAtomId,
  ViewType,
  FieldInitializationExpression,
  ViewOptionsSpec,
  SearchClause,
} from "./model.js";
import type { FactActionKind } from "./protocol-enums/fact.js";
import type { FactActionId, FactId } from "./fact-identities.js";
import type { InlineReferenceTargetStatus } from "./protocol-enums/model.js";
import type {
  DiffSpaceKind,
  PlacementEndpoint,
  RecoveryAction,
  SupertagRelationKind,
} from "./protocol-enums/review.js";

type WithKind<Value, Kind extends string> = Omit<ProtocolDto<Value>, "kind"> & Readonly<{ kind: Kind }>;
type MarkChange = Readonly<{ atomId: TextAtomId; key: string; origin: PreviousValue; review: PreviousValue }>;

type TextDecisionEffect = Omit<
  WithKind<ProtocolTextDecisionEffect, "text">,
  "addedAtomIds" | "deletedAtomIds" | "markChanges"
> &
  Readonly<{
    addedAtomIds: readonly TextAtomId[];
    deletedAtomIds: readonly TextAtomId[];
    markChanges: readonly MarkChange[];
  }>;
type LifecycleDecisionEffect = WithKind<ProtocolLifecycleDecisionEffect, "lifecycle">;
type OwnerDecisionEffect = WithKind<ProtocolOwnerDecisionEffect, "owner">;
type IntrinsicNodeTypeDecisionEffect = Omit<
  WithKind<ProtocolIntrinsicNodeTypeDecisionEffect, "intrinsic-node-type">,
  "origin" | "review"
> &
  Readonly<{ origin: IntrinsicNodeType | null; review: IntrinsicNodeType | null }>;
type InlineReferenceDecisionState = Omit<ProtocolDto<ProtocolInlineReferenceDecisionState>, "targetStatus" | "anchor"> &
  Readonly<{ targetStatus: InlineReferenceTargetStatus; anchor: SequenceAnchor }>;
type InlineReferenceDecisionEffect = Omit<
  WithKind<ProtocolInlineReferenceDecisionEffect, "inline-reference">,
  "origin" | "review"
> &
  Readonly<{ origin: InlineReferenceDecisionState | null; review: InlineReferenceDecisionState | null }>;
type SearchExpressionDecisionState = Omit<
  ProtocolDto<ProtocolSearchExpressionDecisionState>,
  "parentExpressionId" | "anchor" | "clause"
> &
  Readonly<{
    parentExpressionId: FactActionId | null;
    anchor: SequenceAnchor | null;
    clause: SearchClause | null;
  }>;
type SearchExpressionDecisionEffect = Omit<
  WithKind<ProtocolSearchExpressionDecisionEffect, "search-expression">,
  "expressionId" | "origin" | "review"
> &
  Readonly<{
    expressionId: FactActionId;
    origin: SearchExpressionDecisionState | null;
    review: SearchExpressionDecisionState | null;
  }>;
type ViewDefinitionDecisionState = Omit<ProtocolDto<ProtocolViewDefinitionDecisionState>, "viewType" | "options"> &
  Readonly<{ viewType: ViewType; options: ViewOptionsSpec }>;
type ViewDefinitionDecisionEffect = Omit<
  WithKind<ProtocolViewDefinitionDecisionEffect, "view-definition">,
  "viewId" | "origin" | "review"
> &
  Readonly<{
    viewId: FactActionId;
    origin: ViewDefinitionDecisionState | null;
    review: ViewDefinitionDecisionState | null;
  }>;
export type FieldDefinitionConfigurationDecisionState =
  | Readonly<{ kind: "datatype"; datatypeNodeId: string }>
  | Readonly<{ kind: "cardinality"; cardinalityNodeId: string }>
  | Readonly<{ kind: "optionality"; optionalityNodeId: string }>
  | Readonly<{ kind: "initialization-expression"; expression: FieldInitializationExpression }>;
type FieldDefinitionConfigurationDecisionEffect = Omit<
  WithKind<ProtocolFieldDefinitionConfigurationDecisionEffect, "field-definition-configuration">,
  "configurationKind" | "origin" | "review"
> &
  Readonly<{
    configurationKind: FieldDefinitionConfigurationDecisionState["kind"];
    origin: FieldDefinitionConfigurationDecisionState | null;
    review: FieldDefinitionConfigurationDecisionState | null;
  }>;

export type DecisionEffect =
  | TextDecisionEffect
  | (Omit<WithKind<ProtocolStructureDecisionEffect, "structure">, "anchor" | "originRelation" | "reviewRelation"> &
      Readonly<{
        anchor: SequenceAnchor | null;
        originRelation: PlacementRelation | null;
        reviewRelation: PlacementRelation | null;
      }>)
  | LifecycleDecisionEffect
  | OwnerDecisionEffect
  | IntrinsicNodeTypeDecisionEffect
  | (Omit<WithKind<ProtocolSupertagRelationDecisionEffect, "supertag-relation">, "relation"> &
      Readonly<{ relation: SupertagRelationKind }>)
  | WithKind<ProtocolFieldMaterializationDecisionEffect, "field-materialization">
  | InlineReferenceDecisionEffect
  | SearchExpressionDecisionEffect
  | ViewDefinitionDecisionEffect
  | FieldDefinitionConfigurationDecisionEffect;

export type PlacementRelation = Omit<ProtocolDto<ProtocolPlacementRelation>, "afterEndpoint" | "beforeEndpoint"> &
  Readonly<{
    afterEndpoint: PlacementEndpoint | null;
    beforeEndpoint: PlacementEndpoint | null;
  }>;

type ReviewEvidence = Omit<
  ProtocolDto<NonNullable<ProtocolReviewSelection["evidence"]>>,
  "effects" | "proposalTargets" | "supportClosure"
> &
  Readonly<{
    proposalTargets: readonly FactActionId[];
    supportClosure: readonly FactActionId[];
    effects: readonly DecisionEffect[];
  }>;
export type ReviewSelection = Omit<ProtocolDto<ProtocolReviewSelection>, "evidence"> &
  Readonly<{ evidence: ReviewEvidence }>;
type ReviewHunk = Omit<
  ProtocolDto<ProtocolReviewHunk>,
  "diffSpace" | "neutralBridgeAtomIds" | "proposalActionIds" | "selection"
> &
  Readonly<{
    diffSpace: Readonly<{
      kind: DiffSpaceKind;
      identity: string;
    }>;
    neutralBridgeAtomIds: readonly TextAtomId[];
    proposalActionIds: readonly FactActionId[];
    selection: ReviewSelection;
  }>;
export type ReviewQuery = Omit<ProtocolDto<ProtocolReviewQuery>, "hunks"> & Readonly<{ hunks: readonly ReviewHunk[] }>;

export type ResolutionConflictCandidate = Omit<
  ProtocolDto<ProtocolResolutionConflictCandidate>,
  "resolutionId" | "decision"
> &
  Readonly<{ resolutionId: FactId; decision: ResolutionDecision }>;

type UnsupportedDirectIntentConflict = Omit<
  WithKind<ProtocolUnsupportedDirectIntentConflict, "unsupported-direct-intent">,
  "actionKind" | "recoveryActions"
> &
  Readonly<{ actionKind: FactActionKind; recoveryActions: readonly [RecoveryAction] }>;
type IntrinsicNodeTypeConflict = Omit<
  WithKind<ProtocolIntrinsicNodeTypeConflict, "intrinsic-node-type-conflict">,
  "candidates"
> &
  Readonly<{
    candidates: readonly (Omit<
      ProtocolDto<ProtocolIntrinsicNodeTypeConflict["candidates"][number]>,
      "intrinsicNodeType"
    > &
      Readonly<{ intrinsicNodeType: IntrinsicNodeType }>)[];
  }>;
type ResolutionConflict = Omit<
  WithKind<ProtocolResolutionConflict, "resolution-conflict">,
  "proposalFactIds" | "candidates"
> &
  Readonly<{ proposalFactIds: readonly FactId[]; candidates: readonly ResolutionConflictCandidate[] }>;
type PlacementConflict = Omit<WithKind<ProtocolPlacementConflict, "placement-conflict">, "candidates"> &
  Readonly<{
    candidates: readonly (Omit<ProtocolDto<ProtocolPlacementConflict["candidates"][number]>, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)[];
  }>;
type OriginalConflict = WithKind<ProtocolOriginalConflict, "original-conflict">;
export type ConflictIssue =
  | UnsupportedDirectIntentConflict
  | IntrinsicNodeTypeConflict
  | ResolutionConflict
  | PlacementConflict
  | OriginalConflict
  | WithKind<ProtocolSupertagExtensionCycleConflict, "supertag-extension-cycle">;
export type ConflictQuery = Omit<ProtocolDto<ProtocolConflictQuery>, "issues"> &
  Readonly<{ issues: readonly ConflictIssue[] }>;
