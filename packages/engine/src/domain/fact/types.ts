import type { AuthorityReceipt as AuthorityReceiptValue } from "./authority-types.js";
import type { FieldContentDeletionMutation } from "./field-content-types.js";
import type { FieldTemplateConfig, InitializedFieldValue } from "./field-template-types.js";
import type { NodeSeed } from "./node-create-types.js";
import type { NodeType } from "./node-type-types.js";
import type { FactTransactionId, FactTransactionPosition } from "./transaction-types.js";

export const FORMAT_GENERATION = 1 as const;
export const FACT_SCHEMA_VERSION = 8 as const;

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
export type ViewMode = "origin" | "review";

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

export type ValueTarget = Readonly<{
  kind: "node" | "occurrence";
  id: string;
}>;

export type PreviousValue =
  Readonly<{ kind: "unset" }> | Readonly<{ kind: "set"; value: JsonValue }>;

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
      ownerNodeId: string;
      previousOwnerNodeId?: string;
    }>
  | Readonly<{ kind: "node-type-declare"; nodeId: string; nodeType: NodeType }>
  | Readonly<{
      kind: "schema-apply";
      nodeId: string;
      schemaId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "schema-remove";
      nodeId: string;
      schemaId: string;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "schema-field-add";
      schemaId: string;
      fieldDefinitionId: string;
      fieldNodeId: string;
      fieldOccurrenceId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "schema-field-remove";
      schemaId: string;
      fieldDefinitionId: string;
      fieldNodeId: string;
      fieldOccurrenceId: string;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "schema-field-configure";
      schemaId: string;
      fieldDefinitionId: string;
      fieldNodeId: string;
      config: FieldTemplateConfig;
      previousConfig?: FieldTemplateConfig | null;
      observedConfigFactIds?: readonly FactId[];
    }>
  | Readonly<{
      kind: "schema-extension-add";
      schemaId: string;
      baseSchemaId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "schema-extension-remove";
      schemaId: string;
      baseSchemaId: string;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "schema-template-node-add";
      schemaId: string;
      templateNodeId: string;
      templateOccurrenceId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "schema-template-node-remove";
      schemaId: string;
      templateNodeId: string;
      templateOccurrenceId: string;
      previousAnchor?: SequenceAnchor;
    }>
  | Readonly<{
      kind: "template-node-detach";
      ownerNodeId: string;
      templateNodeId: string;
      instanceNodeId: string;
      instanceOccurrenceId: string;
      anchor: SequenceAnchor;
      sourceSchemaIds?: readonly string[];
      sourceApplicationSchemaIds?: readonly string[];
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
  | Readonly<{
      kind: "field-initialize";
      ownerNodeId: string;
      schemaId: string;
      fieldDefinitionId: string;
      fieldNodeId: string;
      fieldOccurrenceId: string;
      source: "static-default" | "auto-initialize";
      values: readonly InitializedFieldValue[];
      observedInitializationFactIds?: readonly FactId[];
    }>
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
  | Readonly<{
      kind: "value-set";
      target: ValueTarget;
      namespace: "property" | "metadata" | "schema";
      key: string;
      value: JsonValue;
      previous?: PreviousValue;
    }>
  | Readonly<{
      kind: "value-unset";
      target: ValueTarget;
      namespace: "property" | "metadata" | "schema";
      key: string;
      previous?: PreviousValue;
    }>;

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
export type MaintenanceFact = Fact & Readonly<{ body: MaintenanceBody }>;

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
  | Readonly<{
      recordKind: "quarantine";
      reason: string;
      updateDigest: string;
    }>;

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

export type AuthorityFault = Readonly<{
  message: string;
  conflictingFactId?: FactId;
}>;
