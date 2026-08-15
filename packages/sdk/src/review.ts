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
  SchemaExtensionCycleConflict as ProtocolSchemaExtensionCycleConflict,
  SchemaRelationDecisionEffect as ProtocolSchemaRelationDecisionEffect,
  StructureDecisionEffect as ProtocolStructureDecisionEffect,
  TextDecisionEffect as ProtocolTextDecisionEffect,
  UnsupportedDirectIntentConflict as ProtocolUnsupportedDirectIntentConflict,
  ValueDecisionEffect as ProtocolValueDecisionEffect,
} from "@lode/protocol/dto/review";
import type { ViewResult as ProtocolViewResult } from "@lode/protocol/dto/projection";
import type {
  FieldTemplateConfig,
  FieldValueSeed,
  NodeType,
  PreviousValue,
  ProtocolDto,
  ResolutionDecision,
  SequenceAnchor,
  TextAtomId,
  ViewMode,
} from "./model.js";
import type { ContributionMutationKind } from "./protocol-enums/fact.js";
import type { FieldInitializationSource, ValueNamespace } from "./protocol-enums/model.js";
import type { ViewFieldState, ViewLayout } from "./protocol-enums/projection.js";
import type { DiffSpaceKind, PlacementEndpoint, RecoveryAction, SchemaRelationKind } from "./protocol-enums/review.js";

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
type ValueDecisionEffect = Omit<
  WithKind<ProtocolValueDecisionEffect, "value">,
  "target" | "namespace" | "origin" | "review"
> &
  Readonly<{
    targetKind: NonNullable<ProtocolValueDecisionEffect["target"]>["$case"];
    targetId: string;
    namespace: ValueNamespace;
    origin: PreviousValue;
    review: PreviousValue;
  }>;
type LifecycleDecisionEffect = WithKind<ProtocolLifecycleDecisionEffect, "lifecycle">;
type OwnerDecisionEffect = WithKind<ProtocolOwnerDecisionEffect, "owner">;
type NodeTypeDecisionEffect = Omit<WithKind<ProtocolNodeTypeDecisionEffect, "node-type">, "origin" | "review"> &
  Readonly<{ origin: NodeType | null; review: NodeType | null }>;
type FieldConfigurationDecisionEffect = Omit<
  WithKind<ProtocolFieldConfigurationDecisionEffect, "field-configuration">,
  "origin" | "review"
> &
  Readonly<{ origin: FieldTemplateConfig | null; review: FieldTemplateConfig | null }>;

export type DecisionEffect =
  | TextDecisionEffect
  | (Omit<WithKind<ProtocolStructureDecisionEffect, "structure">, "anchor" | "originRelation" | "reviewRelation"> &
      Readonly<{
        anchor: SequenceAnchor | null;
        originRelation: PlacementRelation | null;
        reviewRelation: PlacementRelation | null;
      }>)
  | ValueDecisionEffect
  | LifecycleDecisionEffect
  | OwnerDecisionEffect
  | NodeTypeDecisionEffect
  | (Omit<WithKind<ProtocolSchemaRelationDecisionEffect, "schema-relation">, "relation"> &
      Readonly<{ relation: SchemaRelationKind }>)
  | FieldConfigurationDecisionEffect
  | WithKind<ProtocolFieldMaterializationDecisionEffect, "field-materialization">;

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
    candidates: readonly Readonly<{ config: FieldTemplateConfig; contributionIds: readonly string[] }>[];
  }>;
type FieldInitializationConflict = Omit<
  WithKind<ProtocolFieldInitializationConflict, "field-initialization-conflict">,
  "candidates"
> &
  Readonly<{
    candidates: readonly Readonly<{
      initializationId: string;
      schemaId: string;
      source: FieldInitializationSource;
      values: readonly FieldValueSeed[];
    }>[];
  }>;

export type ConflictIssue =
  | UnsupportedDirectIntentConflict
  | NodeTypeConflict
  | ResolutionConflict
  | PlacementConflict
  | WithKind<ProtocolSchemaExtensionCycleConflict, "schema-extension-cycle">
  | FieldConfigConflict
  | FieldInitializationConflict;
export type ConflictQuery = Omit<ProtocolDto<ProtocolConflictQuery>, "issues"> &
  Readonly<{ issues: readonly ConflictIssue[] }>;

type ProtocolViewResultDto = ProtocolDto<ProtocolViewResult>;
export type ViewResult = Omit<ProtocolViewResultDto, "view" | "layout" | "rows"> &
  Readonly<{
    view: ViewMode;
    layout: ViewLayout;
    rows: readonly (Omit<ProtocolViewResultDto["rows"][number], "fields"> &
      Readonly<{
        fields: readonly (Omit<ProtocolViewResultDto["rows"][number]["fields"][number], "state"> &
          Readonly<{ state: ViewFieldState }>)[];
      }>)[];
  }>;
