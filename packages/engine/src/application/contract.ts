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
  ManagedChild,
  EffectiveField,
  MaterializedField,
  ProjectedNode,
  ProjectedOccurrence,
  SchemaFieldItem,
} from "../domain/reconcile/index.js";
import type { ReviewQuery, ReviewSelection } from "../domain/review/index.js";
import type { ConflictIssue, ConflictQuery } from "../domain/conflict/index.js";

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

export type EngineCommand =
  MutationCommand | ReviewCommand | AdjudicateResolutionCommand | HistoryCommand;

export type EngineErrorCode =
  | "invalid-input"
  | "stale-selection"
  | "projection-unavailable"
  | "invocation-conflict"
  | "authority-fault"
  | "history-unavailable";

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
  | "managedChildren"
  | "schemaApplications"
  | "schemaFields"
  | "schemaFieldItems"
  | "schemaExtensions"
  | "schemaSearchMembers"
  | "schemaExtensionConflicts"
  | "conflictIssues"
  | "effectiveFields"
  | "materializedFields";

export type ProjectionPageValue =
  | ProjectedNode
  | ProjectedOccurrence
  | readonly string[]
  | string
  | Readonly<Record<string, JsonValue>>
  | ManagedChild
  | readonly EffectiveField[]
  | readonly MaterializedField[]
  | readonly SchemaFieldItem[]
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
  managedChildren: readonly ManagedChild[];
  schemaApplications: Readonly<Record<string, readonly string[]>>;
  schemaFields: Readonly<Record<string, readonly string[]>>;
  schemaFieldItems: Readonly<Record<string, readonly SchemaFieldItem[]>>;
  schemaExtensions: Readonly<Record<string, readonly string[]>>;
  schemaSearchMembers: Readonly<Record<string, readonly string[]>>;
  schemaExtensionConflicts: Readonly<Record<string, readonly string[]>>;
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

export type EngineQuery =
  | ProjectionQuery
  | ReviewQueryRequest
  | HistoryQueryRequest
  | InvocationQuery
  | ConflictQueryRequest;

export type InvocationOutcome =
  Readonly<{ status: "absent" }> | PublishedResult | CommittedProjectionPendingResult;

export type EngineQueryValue =
  ProjectionPage | ReviewQuery | HistoryQuery | InvocationOutcome | ConflictQuery;

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
