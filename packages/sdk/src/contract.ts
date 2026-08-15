import type {
  AcknowledgeDeletionCommand as ProtocolAcknowledgeDeletionCommand,
  AdjudicateResolutionCommand as ProtocolAdjudicateResolutionCommand,
  CommittedProjectionPendingResult as ProtocolCommittedProjectionPendingResult,
  ConflictQueryRequest as ProtocolConflictQueryRequest,
  EngineError as ProtocolEngineError,
  EngineEvent as ProtocolEngineEvent,
  HardDeleteCommand as ProtocolHardDeleteCommand,
  HardDeletePreviewQuery as ProtocolHardDeletePreviewQuery,
  HistoryCommand as ProtocolHistoryCommand,
  HistoryQueryRequest as ProtocolHistoryQueryRequest,
  InvocationQuery as ProtocolInvocationQuery,
  MutationCommand as ProtocolMutationCommand,
  OutcomeUnknownResult as ProtocolOutcomeUnknownResult,
  ProjectionQuery as ProtocolProjectionQuery,
  PublishedResult as ProtocolPublishedResult,
  RejectedResult as ProtocolRejectedResult,
  ResolveReviewCommand as ProtocolResolveReviewCommand,
  RetireReplicaCommand as ProtocolRetireReplicaCommand,
  ReviewQueryRequest as ProtocolReviewQueryRequest,
  SchemaSearchQueryRequest as ProtocolSchemaSearchQueryRequest,
  SchemaSearchResult as ProtocolSchemaSearchResult,
  ViewQueryRequest as ProtocolViewQueryRequest,
} from "@lode/protocol/dto/engine";
import type { EditMutation } from "./edit.js";
import type { HistoryQuery, HistorySelection } from "./history.js";
import type { HardDeletePreview, HardDeleteSelection } from "./maintenance.js";
import type { AuthorityReceipt, ProtocolDto, ResolutionDecision, ViewMode } from "./model.js";
import type { ProjectionPage, ProjectionPageSection } from "./projection.js";
import type { ConflictQuery, ReviewQuery, ReviewSelection, ViewResult } from "./review.js";
import type { EditIntent, EngineErrorCode, EngineEventKind } from "./protocol-enums/engine.js";

type WithKind<Value, Kind extends string> = Omit<ProtocolDto<Value>, "kind"> & Readonly<{ kind: Kind }>;

export type MutationCommand = Omit<WithKind<ProtocolMutationCommand, "mutate">, "intent" | "mutations"> &
  Readonly<{ intent: EditIntent; mutations: readonly EditMutation[] }>;
export type ReviewCommand = Omit<WithKind<ProtocolResolveReviewCommand, "resolve-review">, "decision" | "selection"> &
  Readonly<{ decision: ResolutionDecision; selection: ReviewSelection }>;
export type AdjudicateResolutionCommand = Omit<
  WithKind<ProtocolAdjudicateResolutionCommand, "adjudicate-resolution">,
  "decision"
> &
  Readonly<{ decision: ResolutionDecision }>;
export type HistoryCommand = Omit<WithKind<ProtocolHistoryCommand, "undo" | "redo">, "selection"> &
  Readonly<{ selection: HistorySelection }>;
type HardDeleteCommand = Omit<WithKind<ProtocolHardDeleteCommand, "hard-delete">, "selection"> &
  Readonly<{ selection: HardDeleteSelection }>;

export type EngineCommand =
  | MutationCommand
  | ReviewCommand
  | AdjudicateResolutionCommand
  | HistoryCommand
  | WithKind<ProtocolAcknowledgeDeletionCommand, "acknowledge-deletion">
  | WithKind<ProtocolRetireReplicaCommand, "retire-replica">
  | HardDeleteCommand;

export type { EngineErrorCode };
export type EngineError = Omit<ProtocolDto<ProtocolEngineError>, "code"> & Readonly<{ code: EngineErrorCode }>;
export type PublishedResult = Omit<ProtocolDto<ProtocolPublishedResult>, "status" | "receipt"> &
  Readonly<{ status: "published"; receipt: AuthorityReceipt }>;
export type CommittedProjectionPendingResult = Omit<
  ProtocolDto<ProtocolCommittedProjectionPendingResult>,
  "status" | "receipt"
> &
  Readonly<{ status: "committed-projection-pending"; receipt: AuthorityReceipt }>;
export type RejectedResult = Omit<ProtocolDto<ProtocolRejectedResult>, "status" | "error"> &
  Readonly<{ status: "rejected"; error: EngineError }>;
type OutcomeUnknownResult = Omit<ProtocolDto<ProtocolOutcomeUnknownResult>, "status"> &
  Readonly<{ status: "outcome-unknown" }>;
export type WriteResult = PublishedResult | CommittedProjectionPendingResult | RejectedResult | OutcomeUnknownResult;

export type ProjectionQuery = Omit<WithKind<ProtocolProjectionQuery, "projection">, "view" | "section"> &
  Readonly<{ view: ViewMode; section?: ProjectionPageSection }>;
export type ReviewQueryRequest = WithKind<ProtocolReviewQueryRequest, "review">;
export type HistoryQueryRequest = WithKind<ProtocolHistoryQueryRequest, "history">;
export type InvocationQuery = WithKind<ProtocolInvocationQuery, "invocation">;
export type ConflictQueryRequest = WithKind<ProtocolConflictQueryRequest, "conflicts">;
export type SchemaSearchQueryRequest = Omit<WithKind<ProtocolSchemaSearchQueryRequest, "schema-search">, "view"> &
  Readonly<{ view: ViewMode }>;
export type ViewQueryRequest = Omit<WithKind<ProtocolViewQueryRequest, "view">, "view"> & Readonly<{ view: ViewMode }>;
export type HardDeletePreviewQuery = WithKind<ProtocolHardDeletePreviewQuery, "hard-delete-preview">;
export type SchemaSearchResult = Omit<ProtocolDto<ProtocolSchemaSearchResult>, "view"> & Readonly<{ view: ViewMode }>;
export type InvocationOutcome = Readonly<{ status: "absent" }> | PublishedResult | CommittedProjectionPendingResult;

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
export type EngineQueryForKind<Kind extends EngineQueryKind> = Extract<EngineQuery, Readonly<{ kind: Kind }>>;
export type EngineQueryInput<Kind extends EngineQueryKind> = EngineQuery & Readonly<{ kind: Kind }>;
export type EngineQueryValueForKind<Kind extends EngineQueryKind> = Extract<
  EngineQueryContract,
  Readonly<{ query: Readonly<{ kind: Kind }> }>
>["value"];
export type EngineQueryValue<Query extends EngineQuery = EngineQuery> = Query extends EngineQuery
  ? EngineQueryValueForKind<Query["kind"]>
  : never;
export type EngineQueryResult<Query extends EngineQuery = EngineQuery> =
  Readonly<{ status: "ok"; value: EngineQueryValue<Query> }> | Readonly<{ status: "rejected"; error: EngineError }>;
export type EngineEvent = Omit<ProtocolDto<ProtocolEngineEvent>, "kind"> & Readonly<{ kind: EngineEventKind }>;
export type Unsubscribe = () => void;
export type EngineApplicationContract = Readonly<{
  execute(command: EngineCommand): Promise<WriteResult>;
  query<Kind extends EngineQueryKind>(
    query: EngineQueryInput<Kind>,
  ): Promise<EngineQueryResult<EngineQueryForKind<Kind>>>;
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe;
}>;
