import type {
  ActorId,
  AuthorityReceipt,
  EditIntent,
  FactFrontier,
  HistoryChannelId,
  InvocationId,
  ResolutionDecision,
  ViewMode,
  WorkspaceId,
} from "../domain/fact/index.js";
import type { EditMutation } from "../domain/edit/index.js";
import type { HistoryQuery, HistorySelection } from "../domain/history/index.js";
import type { ReviewQuery, ReviewSelection } from "../domain/review/index.js";
import type { ConflictQuery } from "../domain/conflict/index.js";
import type { ViewResult } from "../domain/view/index.js";
import type { HardDeleteAssessment, HardDeleteSelection } from "../domain/maintenance/index.js";
import type { ProjectionPage, ProjectionPageSection } from "./projection-contract.js";
import type { ViewQueryRequest } from "./view-contract.js";

export type {
  ProjectionPage,
  ProjectionPageSection,
  ProjectionPageValue,
} from "./projection-contract.js";
export { PROJECTION_PAGE_SECTIONS } from "./projection-contract.js";
export type { HardDeleteBlocker, HardDeleteSelection } from "../domain/maintenance/index.js";

export type MutationCommand = Readonly<{
  kind: "mutate";
  workspaceId: WorkspaceId;
  invocationId: InvocationId;
  actorId: ActorId;
  intent: EditIntent;
  historyChannelId: HistoryChannelId;
  mutations: readonly EditMutation[];
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

export type HardDeletePreview = HardDeleteAssessment &
  Readonly<{
    generationId: string;
    historyImpact: Readonly<{
      affectedInvocationIds: readonly string[];
      affectedChannelIds: readonly string[];
      totalAffectedInvocations: number;
      truncated: boolean;
    }>;
  }>;

export type InvocationOutcome =
  Readonly<{ status: "absent" }> | PublishedResult | CommittedProjectionPendingResult;

export type EngineQueryContract =
  | Readonly<{ query: ProjectionQuery; value: ProjectionPage }>
  | Readonly<{ query: ReviewQueryRequest; value: ReviewQuery }>
  | Readonly<{ query: HistoryQueryRequest; value: HistoryQuery }>
  | Readonly<{ query: InvocationQuery; value: InvocationOutcome }>
  | Readonly<{ query: ConflictQueryRequest; value: ConflictQuery }>
  | Readonly<{ query: SchemaSearchQueryRequest; value: SchemaSearchResult }>
  | Readonly<{ query: ViewQueryRequest; value: ViewResult }>
  | Readonly<{ query: HardDeletePreviewQuery; value: HardDeletePreview }>;

export type EngineQuery = EngineQueryContract["query"];
export type EngineQueryKind = EngineQuery["kind"];
export type EngineQueryForKind<Kind extends EngineQueryKind> = Extract<
  EngineQuery,
  Readonly<{ kind: Kind }>
>;
export type EngineQueryInput<Kind extends EngineQueryKind> = EngineQuery & Readonly<{ kind: Kind }>;

export type EngineQueryValueForKind<Kind extends EngineQueryKind> = Extract<
  EngineQueryContract,
  Readonly<{ query: Readonly<{ kind: Kind }> }>
>["value"];

export type EngineQueryValue<Query extends EngineQuery = EngineQuery> = Query extends EngineQuery
  ? EngineQueryValueForKind<Query["kind"]>
  : never;

export type EngineQueryResult<Query extends EngineQuery = EngineQuery> =
  | Readonly<{ status: "ok"; value: EngineQueryValue<Query> }>
  | Readonly<{ status: "rejected"; error: EngineError }>;

export type EngineEvent = Readonly<{
  kind:
    "authority-advanced" | "projection-published" | "projection-failed" | "projection-recovered";
  workspaceId: WorkspaceId;
  frontier: FactFrontier;
  generationId: string | null;
}>;

export type Unsubscribe = () => void;

export type EngineContract = Readonly<{
  execute(command: EngineCommand): Promise<WriteResult>;
  query<Kind extends EngineQueryKind>(
    query: EngineQueryInput<Kind>,
  ): Promise<EngineQueryResult<EngineQueryForKind<Kind>>>;
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe;
}>;
