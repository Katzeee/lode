import type { FieldContentRemovalAction } from "./field-content-types.js";
import type { FieldDefinitionAction } from "./field-definition-config-types.js";
import type { NodeSeed, OriginalPlacement } from "./node-create-types.js";
import type { IntrinsicNodeType } from "./intrinsic-node-type-types.js";
import type { InlineReferenceAction } from "./inline-reference-types.js";
import type { SearchExpressionAction } from "./search-expression-types.js";
import type { SupertagAction } from "./supertag-types.js";
import type { GovernanceBody } from "./governance-types.js";
import type { ViewAction } from "./view-definition-types.js";

export const FACT_ID_GENERATION = 1 as const;

export type WorkspaceId = string;
export type ReplicaId = string;
export type ActorId = string;
export type InvocationId = string;
export type FactId = `g${number}/${string}/${string}/${number}`;
export type FactActionId = `${FactId}/actions/${number}`;
export type ResolutionId = FactId;
export type HistoryChannelId = string;

export type EditIntent = "direct" | "proposal";
export type ResolutionDecision = "accept" | "reject";
export type ProjectionPerspective = "origin" | "review";

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

export type FactFrontier = Readonly<Record<ReplicaId, number>>;

type FactDot = Readonly<{
  replicaId: ReplicaId;
  sequence: number;
}>;

export type CausalCoordinate = Readonly<{
  dot: FactDot;
  observed: FactFrontier;
  lamport: number;
}>;

export type TextAtomId = `${FactActionId}#${number}`;

export type SequenceAnchor = Readonly<{
  after: string | null;
  before: string | null;
  affinity: "after" | "before";
  fallback: "start" | "end";
}>;

export type PreviousValue = Readonly<{ kind: "unset" }> | Readonly<{ kind: "set"; value: JsonValue }>;

export type AuthoredAction =
  | Readonly<{ kind: "workspace-bootstrap"; workspaceNodeId: string }>
  | Readonly<{
      kind: "node-create";
      nodeId: string;
      ownerNodeId: string;
      originalPlacement: OriginalPlacement | null;
      intrinsicNodeType?: IntrinsicNodeType;
      seed?: NodeSeed;
    }>
  | Readonly<{ kind: "node-trash"; nodeId: string }>
  | Readonly<{
      kind: "node-restore";
      nodeId: string;
      placementId: string;
      parentNodeId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{ kind: "original-promote"; nodeId: string; placementId: string }>
  | Readonly<{
      kind: "placement-create";
      placementId: string;
      nodeId: string;
      parentNodeId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "placement-remove";
      placementId: string;
    }>
  | Readonly<{
      kind: "placement-move";
      placementId: string;
      parentNodeId: string;
      anchor: SequenceAnchor;
    }>
  | SupertagAction
  | Readonly<{
      kind: "template-node-detach";
      ownerNodeId: string;
      templateNodeId: string;
      instanceNodeId: string;
      instanceOccurrenceId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "field-materialize";
      ownerNodeId: string;
      fieldDefinitionId: string;
      fieldNodeId: string;
      fieldOccurrenceId: string;
    }>
  | FieldContentRemovalAction
  | FieldDefinitionAction
  | Readonly<{
      kind: "rich-text-splice";
      nodeId: string;
      deleteAtomIds: readonly TextAtomId[];
      anchor: SequenceAnchor;
      insert: string;
      attributes?: Readonly<Record<string, JsonValue>>;
    }>
  | Readonly<{
      kind: "rich-text-mark";
      nodeId: string;
      atomIds: readonly TextAtomId[];
      key: string;
      value: PreviousValue;
    }>
  | InlineReferenceAction
  | SearchExpressionAction
  | ViewAction;

export type EditBody = Readonly<{
  kind: "edit";
  actorId: ActorId;
  intent: EditIntent;
  actions: readonly [AuthoredAction, ...AuthoredAction[]];
}>;

export type ResolutionBody = Readonly<{
  kind: "resolution";
  actorId: ActorId;
  decision: ResolutionDecision;
  proposalFactIds: readonly FactId[];
  adjudicatesResolutionIds: readonly ResolutionId[];
}>;

type MaintenanceAction =
  | Readonly<{ kind: "deletion-acknowledge"; nodeId: string }>
  | Readonly<{ kind: "replica-retire"; replicaId: ReplicaId }>
  | Readonly<{ kind: "node-purge"; nodeId: string }>;

type MaintenanceBody = Readonly<{
  kind: "maintenance";
  actorId: ActorId;
  action: MaintenanceAction;
}>;

export type FactBody = EditBody | ResolutionBody | MaintenanceBody | GovernanceBody;

export type Fact = Readonly<{
  id: FactId;
  coordinate: CausalCoordinate;
  body: FactBody;
}>;

export type FactAction = Readonly<{
  id: FactActionId;
  factId: FactId;
  index: number;
  coordinate: CausalCoordinate;
  actorId: ActorId;
  intent: EditIntent;
  action: AuthoredAction;
}>;

export type EditFact = Fact & Readonly<{ body: EditBody }>;
export type ResolutionFact = Fact & Readonly<{ body: ResolutionBody }>;

export type FactSnapshot = Readonly<{
  facts: readonly Fact[];
  frontier: FactFrontier;
}>;

export type { FieldContentRemovalAction } from "./field-content-types.js";
export type { InlineReferenceId } from "./inline-reference-types.js";
type RulesVersion = string;
type SchemaVersion = string;

type ProjectionGenerationId = string;

export type ProjectionIdentity = Readonly<{
  workspaceNodeId: WorkspaceId;
  generationId: ProjectionGenerationId;
  frontier: FactFrontier;
  rulesVersion: RulesVersion;
  schemaVersion: SchemaVersion;
}>;
