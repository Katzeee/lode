import type {
  AdjudicateResolutionCommand as ProtocolAdjudicateResolutionCommand,
  CommittedProjectionPendingResult as ProtocolCommittedProjectionPendingResult,
  ConflictQueryRequest as ProtocolConflictQueryRequest,
  EngineError as ProtocolEngineError,
  EngineEvent as ProtocolEngineEvent,
  FinalizeDeletionsCommand as ProtocolFinalizeDeletionsCommand,
  HistoryCommand as ProtocolHistoryCommand,
  HistoryQueryRequest as ProtocolHistoryQueryRequest,
  InvocationQuery as ProtocolInvocationQuery,
  EditCommand as ProtocolEditCommand,
  OutcomeUnknownResult as ProtocolOutcomeUnknownResult,
  ProjectionQuery as ProtocolProjectionQuery,
  PublishedResult as ProtocolPublishedResult,
  RejectedResult as ProtocolRejectedResult,
  ResolveReviewCommand as ProtocolResolveReviewCommand,
  ReviewQueryRequest as ProtocolReviewQueryRequest,
  SupertagInstancesQueryRequest as ProtocolSupertagInstancesQueryRequest,
  SupertagInstancesResult as ProtocolSupertagInstancesResult,
  Backlink as ProtocolBacklink,
  BacklinksQueryRequest as ProtocolBacklinksQueryRequest,
  BacklinksResult as ProtocolBacklinksResult,
  SearchResultsQueryRequest as ProtocolSearchResultsQueryRequest,
  SearchResultsResult as ProtocolSearchResultsResult,
  SearchResultReference as ProtocolSearchResultReference,
  ViewRowsQueryRequest as ProtocolViewRowsQueryRequest,
  ViewRowsResult as ProtocolViewRowsResult,
  ViewRowReference as ProtocolViewRowReference,
  OutlineQueryRequest as ProtocolOutlineQueryRequest,
  OutlineResult as ProtocolOutlineResult,
  OutlineRow as ProtocolOutlineRow,
  TrashEvidenceQueryRequest as ProtocolTrashEvidenceQueryRequest,
  TrashEvidence as ProtocolTrashEvidence,
} from "@lode/protocol/proto";
import type { EditAction } from "./edit.js";
import type { HistoryQuery, HistorySelection } from "./history.js";
import type { FactId } from "./fact-identities.js";
import type {
  AuthorityReceipt,
  ResolutionDecision,
  ProjectionPerspective,
  ViewOptionsSpec,
  ViewType,
  SequenceAnchor,
} from "./model.js";
import type { ProtocolDto, WithKind } from "./protocol-dto.js";
import type { ProjectionPage, ProjectionPageSection } from "./projection.js";
import type { ConflictQuery, ReviewQuery, ReviewSelection } from "./review.js";
import type {
  BacklinkSourceKind,
  EditIntent,
  EngineErrorCode,
  EngineEventKind,
  ViewRowSourceKind,
} from "./protocol-enums/engine.js";
import type { InlineReferenceTargetStatus } from "./protocol-enums/model.js";

/** Cursor window on paged query requests; omitted or null when the caller wants the default page. */
type PageWindow = Readonly<{ after?: string | null; limit?: number | null }>;
type WithPageWindow<Value> = Omit<Value, "after" | "limit"> & PageWindow;

export type EditCommand = Omit<WithKind<ProtocolEditCommand, "edit">, "intent" | "actions"> &
  Readonly<{ intent: EditIntent; actions: readonly EditAction[] }>;
export type ReviewCommand = Omit<WithKind<ProtocolResolveReviewCommand, "resolve-review">, "decision" | "selection"> &
  Readonly<{ decision: ResolutionDecision; selection: ReviewSelection }>;
export type AdjudicateResolutionCommand = Omit<
  WithKind<ProtocolAdjudicateResolutionCommand, "adjudicate-resolution">,
  "decision" | "proposalFactIds" | "resolutionIds"
> &
  Readonly<{
    decision: ResolutionDecision;
    proposalFactIds: readonly FactId[];
    resolutionIds: readonly FactId[];
  }>;
export type HistoryCommand = Omit<WithKind<ProtocolHistoryCommand, "undo" | "redo">, "selection"> &
  Readonly<{ selection: HistorySelection }>;
export type FinalizeDeletionsCommand = WithKind<ProtocolFinalizeDeletionsCommand, "finalize-deletions">;

export type EngineCommand =
  EditCommand | ReviewCommand | AdjudicateResolutionCommand | HistoryCommand | FinalizeDeletionsCommand;

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

export type ProjectionQuery = WithPageWindow<
  Omit<WithKind<ProtocolProjectionQuery, "projection">, "perspective" | "section">
> &
  Readonly<{ perspective: ProjectionPerspective; section?: ProjectionPageSection }>;
export type ReviewQueryRequest = WithPageWindow<WithKind<ProtocolReviewQueryRequest, "review">>;
export type HistoryQueryRequest = WithKind<ProtocolHistoryQueryRequest, "history">;
export type InvocationQuery = WithKind<ProtocolInvocationQuery, "invocation">;
export type ConflictQueryRequest = WithPageWindow<WithKind<ProtocolConflictQueryRequest, "conflicts">>;
export type SupertagInstancesQueryRequest = WithPageWindow<
  Omit<WithKind<ProtocolSupertagInstancesQueryRequest, "supertag-instances">, "perspective">
> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type BacklinksQueryRequest = WithPageWindow<
  Omit<WithKind<ProtocolBacklinksQueryRequest, "backlinks">, "perspective">
> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type SupertagInstancesResult = Omit<ProtocolDto<ProtocolSupertagInstancesResult>, "perspective"> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type Backlink = Omit<ProtocolDto<ProtocolBacklink>, "sourceKind" | "targetStatus"> &
  Readonly<{ sourceKind: BacklinkSourceKind; targetStatus: InlineReferenceTargetStatus }>;
export type BacklinksResult = Omit<ProtocolDto<ProtocolBacklinksResult>, "perspective" | "backlinks"> &
  Readonly<{ perspective: ProjectionPerspective; backlinks: readonly Backlink[] }>;
export type SearchResultsQueryRequest = WithPageWindow<
  Omit<WithKind<ProtocolSearchResultsQueryRequest, "search-results">, "perspective">
> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type SearchResultReference = ProtocolDto<ProtocolSearchResultReference>;
export type SearchResultsResult = Omit<ProtocolDto<ProtocolSearchResultsResult>, "perspective" | "results"> &
  Readonly<{ perspective: ProjectionPerspective; results: readonly SearchResultReference[] }>;
export type ViewRowsQueryRequest = WithPageWindow<
  Omit<WithKind<ProtocolViewRowsQueryRequest, "view-rows">, "perspective" | "viewDefinitionNodeId">
> &
  Readonly<{ perspective: ProjectionPerspective; viewDefinitionNodeId?: string }>;
export type ViewRowReference = Omit<ProtocolDto<ProtocolViewRowReference>, "sourceKind"> &
  Readonly<{ sourceKind: ViewRowSourceKind }>;
export type ViewRowsResult = Omit<
  ProtocolDto<ProtocolViewRowsResult>,
  "perspective" | "viewType" | "rows" | "viewDefinitionNodeId" | "options"
> &
  Readonly<{
    perspective: ProjectionPerspective;
    viewDefinitionNodeId: string | null;
    viewType: ViewType;
    options: ViewOptionsSpec;
    rows: readonly ViewRowReference[];
  }>;
export type OutlineQueryRequest = WithPageWindow<
  Omit<WithKind<ProtocolOutlineQueryRequest, "outline">, "perspective">
> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type OutlineRow = ProtocolDto<ProtocolOutlineRow>;
export type OutlineResult = Omit<ProtocolDto<ProtocolOutlineResult>, "perspective" | "rows"> &
  Readonly<{ perspective: ProjectionPerspective; rows: readonly OutlineRow[] }>;
export type TrashEvidenceQueryRequest = Omit<
  WithKind<ProtocolTrashEvidenceQueryRequest, "trash-evidence">,
  "perspective"
> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type TrashEvidenceResult = Omit<ProtocolDto<ProtocolTrashEvidence>, "perspective" | "anchor"> &
  Readonly<{ perspective: ProjectionPerspective; anchor: SequenceAnchor | null }>;
export type InvocationOutcome = Readonly<{ status: "absent" }> | PublishedResult | CommittedProjectionPendingResult;

export type EngineQueryContract =
  | Readonly<{ query: ProjectionQuery; value: ProjectionPage }>
  | Readonly<{ query: ReviewQueryRequest; value: ReviewQuery }>
  | Readonly<{ query: HistoryQueryRequest; value: HistoryQuery }>
  | Readonly<{ query: InvocationQuery; value: InvocationOutcome }>
  | Readonly<{ query: ConflictQueryRequest; value: ConflictQuery }>
  | Readonly<{ query: SupertagInstancesQueryRequest; value: SupertagInstancesResult }>
  | Readonly<{ query: BacklinksQueryRequest; value: BacklinksResult }>
  | Readonly<{ query: SearchResultsQueryRequest; value: SearchResultsResult }>
  | Readonly<{ query: ViewRowsQueryRequest; value: ViewRowsResult }>
  | Readonly<{ query: OutlineQueryRequest; value: OutlineResult }>
  | Readonly<{ query: TrashEvidenceQueryRequest; value: TrashEvidenceResult }>;
export type EngineQuery = EngineQueryContract["query"];
export type EngineQueryKind = EngineQuery["kind"];
export type EngineQueryForKind<Kind extends EngineQueryKind> = Extract<EngineQuery, Readonly<{ kind: Kind }>>;
export type EngineQueryInput<Kind extends EngineQueryKind> = EngineQuery & Readonly<{ kind: Kind }>;
export type EngineQueryValueForKind<Kind extends EngineQueryKind> = Extract<
  EngineQueryContract,
  Readonly<{ query: Readonly<{ kind: Kind }> }>
>["value"];
// Deliberately non-distributive: a distributive conditional fails to reduce for the concrete
// intersection request types, widening every query result to the full value union.
export type EngineQueryValue<Query extends EngineQuery = EngineQuery> = EngineQueryValueForKind<Query["kind"]>;
export type EngineQueryResult<Query extends EngineQuery = EngineQuery> =
  Readonly<{ status: "ok"; value: EngineQueryValue<Query> }> | Readonly<{ status: "rejected"; error: EngineError }>;
export type EngineEvent = Omit<ProtocolDto<ProtocolEngineEvent>, "kind"> & Readonly<{ kind: EngineEventKind }>;
export type Unsubscribe = () => void;
export type EventFailureListener = (error: unknown) => void;
export type EngineApplicationContract = Readonly<{
  execute(command: EngineCommand): Promise<WriteResult>;
  query<Kind extends EngineQueryKind>(
    query: EngineQueryInput<Kind>,
  ): Promise<EngineQueryResult<EngineQueryForKind<Kind>>>;
  subscribe(listener: (event: EngineEvent) => void, onError: EventFailureListener): Unsubscribe;
}>;
