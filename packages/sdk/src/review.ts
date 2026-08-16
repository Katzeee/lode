import type {
  ConflictQueryResult as ProtocolConflictQuery,
  FieldConfigConflict as ProtocolFieldConfigConflict,
  FieldConfigurationDecisionEffect as ProtocolFieldConfigurationDecisionEffect,
  FieldInitializationConflict as ProtocolFieldInitializationConflict,
  FieldMaterializationDecisionEffect as ProtocolFieldMaterializationDecisionEffect,
  LifecycleDecisionEffect as ProtocolLifecycleDecisionEffect,
  NodeTypeConflict as ProtocolNodeTypeConflict,
  NodeTypeDecisionEffect as ProtocolNodeTypeDecisionEffect,
  OwnerDecisionEffect as ProtocolOwnerDecisionEffect,
  PlacementConflict as ProtocolPlacementConflict,
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
} from "@lode/protocol/dto/review";
import type {
  SupertagFieldConfig,
  FieldValueSeed,
  NodeType,
  PreviousValue,
  ProtocolDto,
  ResolutionDecision,
  SequenceAnchor,
  TextAtomId,
  ViewType,
  FieldDatatype,
  FieldCardinality,
  FieldInitializationExpression,
} from "./model.js";
import type { ContributionMutationKind } from "./protocol-enums/fact.js";
import type { FieldInitializationSource, InlineReferenceTargetStatus } from "./protocol-enums/model.js";
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
type NodeTypeDecisionEffect = Omit<WithKind<ProtocolNodeTypeDecisionEffect, "node-type">, "origin" | "review"> &
  Readonly<{ origin: NodeType | null; review: NodeType | null }>;
type FieldConfigurationDecisionEffect = Omit<
  WithKind<ProtocolFieldConfigurationDecisionEffect, "field-configuration">,
  "origin" | "review"
> &
  Readonly<{ origin: SupertagFieldConfig | null; review: SupertagFieldConfig | null }>;
type InlineReferenceDecisionState = Omit<ProtocolDto<ProtocolInlineReferenceDecisionState>, "targetStatus" | "anchor"> &
  Readonly<{ targetStatus: InlineReferenceTargetStatus; anchor: SequenceAnchor }>;
type InlineReferenceDecisionEffect = Omit<
  WithKind<ProtocolInlineReferenceDecisionEffect, "inline-reference">,
  "origin" | "review"
> &
  Readonly<{ origin: InlineReferenceDecisionState | null; review: InlineReferenceDecisionState | null }>;
type ViewDefinitionDecisionState = Omit<ProtocolDto<ProtocolViewDefinitionDecisionState>, "viewType"> &
  Readonly<{ viewType: ViewType }>;
type ViewDefinitionDecisionEffect = Omit<
  WithKind<ProtocolViewDefinitionDecisionEffect, "view-definition">,
  "origin" | "review"
> &
  Readonly<{ origin: ViewDefinitionDecisionState | null; review: ViewDefinitionDecisionState | null }>;
export type FieldDefinitionConfigurationDecisionState =
  | Readonly<{ kind: "datatype"; datatype: FieldDatatype }>
  | Readonly<{ kind: "cardinality"; cardinality: FieldCardinality }>
  | Readonly<{ kind: "initialization-expression"; expression: FieldInitializationExpression }>;
type FieldDefinitionConfigurationDecisionEffect = Omit<
  WithKind<ProtocolFieldDefinitionConfigurationDecisionEffect, "field-definition-configuration">,
  "origin" | "review"
> &
  Readonly<{
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
  | NodeTypeDecisionEffect
  | (Omit<WithKind<ProtocolSupertagRelationDecisionEffect, "supertag-relation">, "relation"> &
      Readonly<{ relation: SupertagRelationKind }>)
  | FieldConfigurationDecisionEffect
  | WithKind<ProtocolFieldMaterializationDecisionEffect, "field-materialization">
  | InlineReferenceDecisionEffect
  | ViewDefinitionDecisionEffect
  | FieldDefinitionConfigurationDecisionEffect;

export type PlacementRelation = Omit<ProtocolDto<ProtocolPlacementRelation>, "afterEndpoint" | "beforeEndpoint"> &
  Readonly<{
    afterEndpoint: PlacementEndpoint | null;
    beforeEndpoint: PlacementEndpoint | null;
  }>;

type ReviewEvidence = Omit<ProtocolDto<NonNullable<ProtocolReviewSelection["evidence"]>>, "effects"> &
  Readonly<{ effects: readonly DecisionEffect[] }>;
export type ReviewSelection = Omit<ProtocolDto<ProtocolReviewSelection>, "evidence"> &
  Readonly<{ evidence: ReviewEvidence }>;
type ReviewHunk = Omit<ProtocolDto<ProtocolReviewHunk>, "diffSpace" | "neutralBridgeAtomIds" | "selection"> &
  Readonly<{
    diffSpace: Readonly<{
      kind: DiffSpaceKind;
      identity: string;
    }>;
    neutralBridgeAtomIds: readonly TextAtomId[];
    selection: ReviewSelection;
  }>;
export type ReviewQuery = Omit<ProtocolDto<ProtocolReviewQuery>, "hunks"> & Readonly<{ hunks: readonly ReviewHunk[] }>;

export type ResolutionConflictCandidate = Omit<ProtocolDto<ProtocolResolutionConflictCandidate>, "decision"> &
  Readonly<{ decision: ResolutionDecision }>;

type UnsupportedDirectIntentConflict = Omit<
  WithKind<ProtocolUnsupportedDirectIntentConflict, "unsupported-direct-intent">,
  "mutationKind" | "recoveryActions"
> &
  Readonly<{ mutationKind: ContributionMutationKind; recoveryActions: readonly [RecoveryAction] }>;
type NodeTypeConflict = Omit<WithKind<ProtocolNodeTypeConflict, "node-type-conflict">, "candidates"> &
  Readonly<{
    candidates: readonly (Omit<ProtocolDto<ProtocolNodeTypeConflict["candidates"][number]>, "nodeType"> &
      Readonly<{ nodeType: NodeType }>)[];
  }>;
type ResolutionConflict = Omit<WithKind<ProtocolResolutionConflict, "resolution-conflict">, "candidates"> &
  Readonly<{ candidates: readonly ResolutionConflictCandidate[] }>;
type PlacementConflict = Omit<WithKind<ProtocolPlacementConflict, "placement-conflict">, "candidates"> &
  Readonly<{
    candidates: readonly (Omit<ProtocolDto<ProtocolPlacementConflict["candidates"][number]>, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)[];
  }>;
type FieldConfigConflict = Omit<WithKind<ProtocolFieldConfigConflict, "field-config-conflict">, "candidates"> &
  Readonly<{
    candidates: readonly Readonly<{ config: SupertagFieldConfig; contributionIds: readonly string[] }>[];
  }>;
type FieldInitializationConflict = Omit<
  WithKind<ProtocolFieldInitializationConflict, "field-initialization-conflict">,
  "candidates"
> &
  Readonly<{
    candidates: readonly Readonly<{
      initializationId: string;
      supertagId: string;
      source: FieldInitializationSource;
      values: readonly FieldValueSeed[];
    }>[];
  }>;

export type ConflictIssue =
  | UnsupportedDirectIntentConflict
  | NodeTypeConflict
  | ResolutionConflict
  | PlacementConflict
  | WithKind<ProtocolSupertagExtensionCycleConflict, "supertag-extension-cycle">
  | FieldConfigConflict
  | FieldInitializationConflict;
export type ConflictQuery = Omit<ProtocolDto<ProtocolConflictQuery>, "issues"> &
  Readonly<{ issues: readonly ConflictIssue[] }>;
