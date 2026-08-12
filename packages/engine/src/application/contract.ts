import type {
  ActorId,
  AuthorityReceipt,
  EditIntent,
  FactFrontier,
  HistoryChannelId,
  InvocationId,
  Mutation,
  ResolutionDecision,
  ViewMode,
  WorkspaceId,
} from "../domain/fact/index.js";
import type { HistoryQuery, HistorySelection } from "../domain/history/index.js";
import type { JsonValue, ProjectionIdentity } from "../domain/fact/index.js";
import type {
  EffectiveField,
  MaterializedField,
  DefinitionStatus,
  ProjectedNode,
  ProjectedOccurrence,
  SchemaFieldItem,
  TemplateNodeInstance,
} from "../domain/reconcile/index.js";
import type { ReviewQuery, ReviewSelection } from "../domain/review/index.js";
import type { ConflictIssue, ConflictQuery } from "../domain/conflict/index.js";
import type { ViewResult } from "../domain/view/index.js";
import type { ViewQueryRequest } from "./view-contract.js";

export type MutationCommand = Readonly<{
  kind: "mutate";
  workspaceId: WorkspaceId;
  invocationId: InvocationId;
  actorId: ActorId;
  intent: EditIntent;
  historyChannelId: HistoryChannelId;
  mutations: readonly Mutation[];
}>;

export type ReviewCommand = Readonly<{
  kind: "resolve-review";
  workspaceId: WorkspaceId;
  invocationId: InvocationId;
  actorId: ActorId;
  decision: ResolutionDecision;
  selection: ReviewSelection;
}>;

export type AdjudicateResolutionCommand = Readonly<{
  kind: "adjudicate-resolution";
  workspaceId: WorkspaceId;
  invocationId: InvocationId;
  actorId: ActorId;
  decision: ResolutionDecision;
  proposalContributionIds: readonly string[];
  resolutionIds: readonly string[];
}>;

export type HistoryCommand = Readonly<{
  kind: "undo" | "redo";
  workspaceId: WorkspaceId;
  invocationId: InvocationId;
  actorId: ActorId;
  selection: HistorySelection;
}>;

export type AcknowledgeDeletionCommand = Readonly<{
  kind: "acknowledge-deletion";
  workspaceId: WorkspaceId;
  invocationId: InvocationId;
  actorId: ActorId;
  nodeId: string;
  deletionFactIds: readonly string[];
}>;

export type RetireReplicaCommand = Readonly<{
  kind: "retire-replica";
  workspaceId: WorkspaceId;
  invocationId: InvocationId;
  actorId: ActorId;
  replicaId: string;
}>;

export type HardDeleteSelection = Readonly<{
  workspaceId: WorkspaceId;
  frontier: FactFrontier;
  nodeId: string;
  deletionFactIds: readonly string[];
  acknowledgementFactIds: readonly string[];
  retiredReplicaIds: readonly string[];
}>;

export type HardDeleteCommand = Readonly<{
  kind: "hard-delete";
  workspaceId: WorkspaceId;
  invocationId: InvocationId;
  actorId: ActorId;
  selection: HardDeleteSelection;
}>;

export type EngineCommand =
  | MutationCommand
  | ReviewCommand
  | AdjudicateResolutionCommand
  | HistoryCommand
  | AcknowledgeDeletionCommand
  | RetireReplicaCommand
  | HardDeleteCommand;

export type EngineErrorCode =
  | "invalid-input"
  | "stale-selection"
  | "projection-unavailable"
  | "invocation-conflict"
  | "authority-fault"
  | "history-unavailable"
  | "maintenance-blocked";

export type EngineError = Readonly<{
  code: EngineErrorCode;
  message: string;
  currentGenerationId: string | null;
}>;

export type PublishedResult = Readonly<{
  status: "published";
  receipt: AuthorityReceipt;
  generationId: string;
}>;

export type CommittedProjectionPendingResult = Readonly<{
  status: "committed-projection-pending";
  receipt: AuthorityReceipt;
  publishedGenerationId: string | null;
  failure: string;
}>;

export type RejectedResult = Readonly<{
  status: "rejected";
  error: EngineError;
}>;

export type OutcomeUnknownResult = Readonly<{
  status: "outcome-unknown";
  invocationId: InvocationId;
}>;

export type WriteResult =
  PublishedResult | CommittedProjectionPendingResult | RejectedResult | OutcomeUnknownResult;

export type ProjectionQuery = Readonly<{
  kind: "projection";
  workspaceId: WorkspaceId;
  view: ViewMode;
  section?: ProjectionPageSection;
  after?: string | null;
  limit?: number;
}>;

export type ProjectionPageSection =
  | "nodes"
  | "occurrences"
  | "children"
  | "canonicalOccurrences"
  | "addressedValues"
  | "schemaApplications"
  | "schemaFields"
  | "schemaFieldItems"
  | "schemaTemplateNodes"
  | "templateNodeInstances"
  | "schemaExtensions"
  | "schemaSearchMembers"
  | "schemaExtensionConflicts"
  | "definitionStatuses"
  | "conflictIssues"
  | "effectiveFields"
  | "materializedFields";

export type ProjectionPageValue =
  | ProjectedNode
  | ProjectedOccurrence
  | readonly string[]
  | string
  | Readonly<Record<string, JsonValue>>
  | readonly EffectiveField[]
  | readonly MaterializedField[]
  | readonly SchemaFieldItem[]
  | TemplateNodeInstance
  | DefinitionStatus
  | ConflictIssue;

export type ProjectionPage = Readonly<{
  identity: ProjectionIdentity;
  view: ViewMode;
  section: ProjectionPageSection;
  entries: readonly Readonly<{ identity: string; value: ProjectionPageValue }>[];
  next: string | null;
  nodes: Readonly<Record<string, ProjectedNode>>;
  occurrences: Readonly<Record<string, ProjectedOccurrence>>;
  children: Readonly<Record<string, readonly string[]>>;
  canonicalOccurrences: Readonly<Record<string, string>>;
  addressedValues: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  schemaApplications: Readonly<Record<string, readonly string[]>>;
  schemaFields: Readonly<Record<string, readonly string[]>>;
  schemaFieldItems: Readonly<Record<string, readonly SchemaFieldItem[]>>;
  schemaTemplateNodes: Readonly<Record<string, readonly string[]>>;
  templateNodeInstances: readonly TemplateNodeInstance[];
  schemaExtensions: Readonly<Record<string, readonly string[]>>;
  schemaSearchMembers: Readonly<Record<string, readonly string[]>>;
  schemaExtensionConflicts: Readonly<Record<string, readonly string[]>>;
  definitionStatuses: Readonly<Record<string, DefinitionStatus>>;
  conflictIssues: Readonly<Record<string, ConflictIssue>>;
  effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
  materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
}>;

export type ReviewQueryRequest = Readonly<{
  kind: "review";
  workspaceId: WorkspaceId;
  after?: string | null;
  limit?: number;
}>;

export type HistoryQueryRequest = Readonly<{
  kind: "history";
  workspaceId: WorkspaceId;
  channelId: HistoryChannelId;
}>;

export type InvocationQuery = Readonly<{
  kind: "invocation";
  workspaceId: WorkspaceId;
  invocationId: InvocationId;
}>;

export type ConflictQueryRequest = Readonly<{
  kind: "conflicts";
  workspaceId: WorkspaceId;
  after?: string | null;
  limit?: number;
}>;

export type SchemaSearchQueryRequest = Readonly<{
  kind: "schema-search";
  workspaceId: WorkspaceId;
  view: ViewMode;
  schemaId: string;
  after?: string | null;
  limit?: number;
}>;

export type SchemaSearchResult = Readonly<{
  generationId: string;
  frontier: FactFrontier;
  view: ViewMode;
  schemaId: string;
  nodeIds: readonly string[];
  next: string | null;
}>;

export type HardDeletePreviewQuery = Readonly<{
  kind: "hard-delete-preview";
  workspaceId: WorkspaceId;
  nodeId: string;
}>;

export type HardDeleteBlocker =
  | "already-purged"
  | "not-tombstoned"
  | "pending-proposal"
  | "replica-unconfirmed"
  | "outcome-unknown";

export type HardDeletePreview = Readonly<{
  generationId: string;
  selection: HardDeleteSelection;
  referenceOccurrenceIds: readonly string[];
  schemaApplicationNodeIds: readonly string[];
  materializedFieldNodeIds: readonly string[];
  pendingProposalContributionIds: readonly string[];
  knownReplicaIds: readonly string[];
  acknowledgedReplicaIds: readonly string[];
  outcomeUnknownInvocationIds: readonly string[];
  historyImpact: Readonly<{
    affectedInvocationIds: readonly string[];
    affectedChannelIds: readonly string[];
    totalAffectedInvocations: number;
    truncated: boolean;
  }>;
  blockers: readonly HardDeleteBlocker[];
  canExecute: boolean;
}>;

export type EngineQuery =
  | ProjectionQuery
  | ReviewQueryRequest
  | HistoryQueryRequest
  | InvocationQuery
  | ConflictQueryRequest
  | SchemaSearchQueryRequest
  | ViewQueryRequest
  | HardDeletePreviewQuery;

export type InvocationOutcome =
  Readonly<{ status: "absent" }> | PublishedResult | CommittedProjectionPendingResult;

export type EngineQueryValue =
  | ProjectionPage
  | ReviewQuery
  | HistoryQuery
  | InvocationOutcome
  | ConflictQuery
  | SchemaSearchResult
  | ViewResult
  | HardDeletePreview;

export type EngineQueryResult =
  | Readonly<{ status: "ok"; value: EngineQueryValue }>
  | Readonly<{ status: "rejected"; error: EngineError }>;

export type EngineEvent = Readonly<{
  kind:
    "authority-advanced" | "projection-published" | "projection-failed" | "projection-recovered";
  workspaceId: WorkspaceId;
  frontier: FactFrontier;
  generationId: string | null;
  affectedOwnerIds: readonly string[];
}>;

export type Unsubscribe = () => void;

export type EngineContract = Readonly<{
  execute(command: EngineCommand): Promise<WriteResult>;
  query(query: EngineQuery): Promise<EngineQueryResult>;
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe;
}>;
