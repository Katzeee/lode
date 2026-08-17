import type { AuthorityReceipt as AuthorityReceiptValue } from "./authority-types.js";
import type { FieldContentDeletionMutation } from "./field-content-types.js";
import type { FieldDefinitionConfigMutation } from "./field-definition-config-types.js";
import type { NodeSeed } from "./node-create-types.js";
import type { IntrinsicNodeType } from "./intrinsic-node-type-types.js";
import type { FactTransactionId, FactTransactionPosition } from "./transaction-types.js";
import type { InlineReferenceMutation } from "./inline-reference-types.js";
import type { SearchExpressionMutation } from "./search-expression-types.js";
import type { SupertagMutation } from "./supertag-types.js";
import type {
  SharedDefaultViewDefinitionAttachMutation,
  SharedDefaultViewDefinitionDetachMutation,
  SharedDefaultViewDefinitionModeSetMutation,
  SharedDefaultViewDefinitionOptionsSetMutation,
  SharedDefaultViewDefinitionSortByNameSetMutation,
} from "./view-definition-types.js";

export const FORMAT_GENERATION = 1 as const;
export const FACT_SCHEMA_VERSION = 1 as const;

export type WorkspaceId = string;
export type ReplicaId = string;
export type ActorId = string;
export type InvocationId = string;
export type ContributionId = string;
export type ResolutionId = string;
export type FactId = string;
export type HistoryChannelId = string;

export type EditIntent = "direct" | "proposal";
export type ResolutionDecision = "accept" | "reject";
export type ProjectionPerspective = "origin" | "review";

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

export type FactFrontier = Readonly<Record<ReplicaId, number>>;

export type FactDot = Readonly<{
  replicaId: ReplicaId;
  sequence: number;
}>;

export type CausalCoordinate = Readonly<{
  dot: FactDot;
  observed: FactFrontier;
  lamport: number;
}>;

export type TextAtomId = `${string}#${number}`;

export type SequenceAnchor = Readonly<{
  after: string | null;
  before: string | null;
  affinity: "after" | "before";
  fallback: "start" | "end";
}>;

export type PreviousValue = Readonly<{ kind: "unset" }> | Readonly<{ kind: "set"; value: JsonValue }>;

export type Mutation =
  | Readonly<{ kind: "node-create"; nodeId: string; seed?: NodeSeed }>
  | Readonly<{ kind: "node-delete"; nodeId: string }>
  | Readonly<{ kind: "node-restore"; nodeId: string; deletionFactId: FactId }>
  | Readonly<{
      kind: "occurrence-create";
      occurrenceId: string;
      nodeId: string;
      parentNodeId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "occurrence-delete";
      occurrenceId: string;
      previousParentNodeId?: string;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "occurrence-restore";
      occurrenceId: string;
      deletionFactId: FactId;
      parentNodeId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "occurrence-move";
      occurrenceId: string;
      parentNodeId: string;
      anchor: SequenceAnchor;
      previousParentNodeId?: string;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "node-owner-set";
      nodeId: string;
      ownerNodeId: string | null;
      previousOwnerNodeId?: string | null;
    }>
  | Readonly<{
      kind: "metanode-attach";
      hostNodeId: string;
      metanodeId: string;
    }>
  | Readonly<{ kind: "intrinsic-node-type-declare"; nodeId: string; intrinsicNodeType: IntrinsicNodeType }>
  | SupertagMutation
  | Readonly<{
      kind: "template-node-detach";
      ownerNodeId: string;
      templateNodeId: string;
      instanceNodeId: string;
      instanceOccurrenceId: string;
      anchor: SequenceAnchor;
      sourceSupertagIds?: readonly string[];
      sourceApplicationSupertagIds?: readonly string[];
      sourceTemplateOccurrenceIds?: readonly string[];
    }>
  | Readonly<{
      kind: "field-materialize";
      ownerNodeId: string;
      fieldDefinitionId: string;
      fieldNodeId: string;
      fieldOccurrenceId: string;
    }>
  | FieldContentDeletionMutation
  | FieldDefinitionConfigMutation
  | Readonly<{
      kind: "text-splice";
      nodeId: string;
      deleteAtomIds: readonly TextAtomId[];
      deletedAtoms?: readonly Readonly<{
        id: TextAtomId;
        value: string;
        attributes: Readonly<Record<string, JsonValue>>;
      }>[];
      anchor: SequenceAnchor;
      insert: string;
      attributes?: Readonly<Record<string, JsonValue>>;
    }>
  | Readonly<{
      kind: "text-mark";
      nodeId: string;
      atomIds: readonly TextAtomId[];
      key: string;
      value: PreviousValue;
      previous?: PreviousValue;
    }>
  | InlineReferenceMutation
  | SearchExpressionMutation
  | SharedDefaultViewDefinitionAttachMutation
  | SharedDefaultViewDefinitionDetachMutation
  | SharedDefaultViewDefinitionModeSetMutation
  | SharedDefaultViewDefinitionOptionsSetMutation
  | SharedDefaultViewDefinitionSortByNameSetMutation;

export type ContributionBody = Readonly<{
  kind: "contribution";
  actorId: ActorId;
  intent: EditIntent;
  mutation: Mutation;
}>;

export type ResolutionBody = Readonly<{
  kind: "resolution";
  actorId: ActorId;
  decision: ResolutionDecision;
  proposalContributionIds: readonly ContributionId[];
  adjudicatesResolutionIds: readonly ResolutionId[];
}>;

export type MaintenanceAction =
  | Readonly<{
      kind: "deletion-acknowledge";
      nodeId: string;
      deletionFactIds: readonly FactId[];
    }>
  | Readonly<{ kind: "replica-retire"; replicaId: ReplicaId }>
  | Readonly<{
      kind: "node-purge";
      nodeId: string;
      deletionFactIds: readonly FactId[];
      acknowledgementFactIds: readonly FactId[];
      retiredReplicaIds: readonly ReplicaId[];
    }>;

export type MaintenanceBody = Readonly<{
  kind: "maintenance";
  actorId: ActorId;
  action: MaintenanceAction;
}>;

export type FactBody = ContributionBody | ResolutionBody | MaintenanceBody;

export type Fact = Readonly<{
  formatGeneration: typeof FORMAT_GENERATION;
  schemaVersion: typeof FACT_SCHEMA_VERSION;
  workspaceId: WorkspaceId;
  id: FactId;
  transaction: FactTransactionPosition;
  coordinate: CausalCoordinate;
  body: FactBody;
  contentDigest: string;
}>;

export type ContributionFact = Fact & Readonly<{ body: ContributionBody }>;
export type ResolutionFact = Fact & Readonly<{ body: ResolutionBody }>;

export type FactSnapshot = Readonly<{
  facts: readonly Fact[];
  frontier: FactFrontier;
}>;

export type Admission = Readonly<{
  kind: "ready" | "pending" | "fault";
  snapshot: FactSnapshot;
  pendingTransactionIds: readonly FactTransactionId[];
  fault: string | null;
}>;

export type { AuthorityReceipt, HistoryOperation, ReceiptLineage } from "./authority-types.js";
export type { FieldContentDeletionMutation } from "./field-content-types.js";
export type { InlineReferenceId, InlineReferenceMutation } from "./inline-reference-types.js";
export type {
  FactTransaction,
  FactTransactionId,
  FactTransactionPlan,
  FactTransactionPosition,
  FactWrite,
} from "./transaction-types.js";

export type AuthorityRecord =
  | Readonly<{ recordKind: "fact"; fact: Fact }>
  | Readonly<{ recordKind: "receipt"; receipt: AuthorityReceiptValue }>
  | Readonly<{ recordKind: "quarantine"; reason: string; updateDigest: string }>;

export type RulesVersion = string;
export type SchemaVersion = string;

export type ProjectionGenerationId = string;

export type ProjectionIdentity = Readonly<{
  workspaceNodeId: WorkspaceId;
  generationId: ProjectionGenerationId;
  frontier: FactFrontier;
  rulesVersion: RulesVersion;
  schemaVersion: SchemaVersion;
}>;
