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
  EditCommand as ProtocolEditCommand,
  OutcomeUnknownResult as ProtocolOutcomeUnknownResult,
  ProjectionQuery as ProtocolProjectionQuery,
  PublishedResult as ProtocolPublishedResult,
  RejectedResult as ProtocolRejectedResult,
  ResolveReviewCommand as ProtocolResolveReviewCommand,
  RetireReplicaCommand as ProtocolRetireReplicaCommand,
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
  DebugNodeQueryRequest as ProtocolDebugNodeQueryRequest,
  DebugNodeResult as ProtocolDebugNodeResult,
  TrashEvidenceQueryRequest as ProtocolTrashEvidenceQueryRequest,
  TrashEvidence as ProtocolTrashEvidence,
} from "@lode/protocol/dto/engine";
import type { EditAction } from "./edit.js";
import type { HistoryQuery, HistorySelection } from "./history.js";
import type { HardDeletePreview, HardDeleteSelection } from "./maintenance.js";
import type { FactActionId, FactId } from "./fact-identities.js";
import type {
  AuthorityReceipt,
  ProtocolDto,
  ResolutionDecision,
  ProjectionPerspective,
  ViewOptionsSpec,
  ViewType,
  SequenceAnchor,
} from "./model.js";
import type { MaterializedField, ProjectedNode, ProjectionPage, ProjectionPageSection } from "./projection.js";
import type { ConflictQuery, ReviewQuery, ReviewSelection } from "./review.js";
import type {
  BacklinkSourceKind,
  EditIntent,
  EngineErrorCode,
  EngineEventKind,
  ViewRowSourceKind,
} from "./protocol-enums/engine.js";
import type { InlineReferenceTargetStatus } from "./protocol-enums/model.js";

type WithKind<Value, Kind extends string> = Omit<ProtocolDto<Value>, "kind"> & Readonly<{ kind: Kind }>;

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
type AcknowledgeDeletionCommand = Omit<
  WithKind<ProtocolAcknowledgeDeletionCommand, "acknowledge-deletion">,
  "deletionActionIds"
> &
  Readonly<{ deletionActionIds: readonly FactActionId[] }>;
export type HistoryCommand = Omit<WithKind<ProtocolHistoryCommand, "undo" | "redo">, "selection"> &
  Readonly<{ selection: HistorySelection }>;
type HardDeleteCommand = Omit<WithKind<ProtocolHardDeleteCommand, "hard-delete">, "selection"> &
  Readonly<{ selection: HardDeleteSelection }>;

export type EngineCommand =
  | EditCommand
  | ReviewCommand
  | AdjudicateResolutionCommand
  | HistoryCommand
  | AcknowledgeDeletionCommand
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

export type ProjectionQuery = Omit<WithKind<ProtocolProjectionQuery, "projection">, "perspective" | "section"> &
  Readonly<{ perspective: ProjectionPerspective; section?: ProjectionPageSection }>;
export type ReviewQueryRequest = WithKind<ProtocolReviewQueryRequest, "review">;
export type HistoryQueryRequest = WithKind<ProtocolHistoryQueryRequest, "history">;
export type InvocationQuery = WithKind<ProtocolInvocationQuery, "invocation">;
export type ConflictQueryRequest = WithKind<ProtocolConflictQueryRequest, "conflicts">;
export type SupertagInstancesQueryRequest = Omit<
  WithKind<ProtocolSupertagInstancesQueryRequest, "supertag-instances">,
  "perspective"
> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type HardDeletePreviewQuery = WithKind<ProtocolHardDeletePreviewQuery, "hard-delete-preview">;
export type BacklinksQueryRequest = Omit<WithKind<ProtocolBacklinksQueryRequest, "backlinks">, "perspective"> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type SupertagInstancesResult = Omit<ProtocolDto<ProtocolSupertagInstancesResult>, "perspective"> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type Backlink = Omit<ProtocolDto<ProtocolBacklink>, "sourceKind" | "targetStatus"> &
  Readonly<{ sourceKind: BacklinkSourceKind; targetStatus: InlineReferenceTargetStatus }>;
export type BacklinksResult = Omit<ProtocolDto<ProtocolBacklinksResult>, "perspective" | "backlinks"> &
  Readonly<{ perspective: ProjectionPerspective; backlinks: readonly Backlink[] }>;
export type SearchResultsQueryRequest = Omit<
  WithKind<ProtocolSearchResultsQueryRequest, "search-results">,
  "perspective"
> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type SearchResultReference = ProtocolDto<ProtocolSearchResultReference>;
export type SearchResultsResult = Omit<ProtocolDto<ProtocolSearchResultsResult>, "perspective" | "results"> &
  Readonly<{ perspective: ProjectionPerspective; results: readonly SearchResultReference[] }>;
export type ViewRowsQueryRequest = Omit<
  WithKind<ProtocolViewRowsQueryRequest, "view-rows">,
  "perspective" | "viewDefinitionNodeId"
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
export type OutlineQueryRequest = Omit<WithKind<ProtocolOutlineQueryRequest, "outline">, "perspective"> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type OutlineRow = ProtocolDto<ProtocolOutlineRow>;
export type OutlineResult = Omit<ProtocolDto<ProtocolOutlineResult>, "perspective" | "rows"> &
  Readonly<{ perspective: ProjectionPerspective; rows: readonly OutlineRow[] }>;
export type DebugNodeQueryRequest = Omit<WithKind<ProtocolDebugNodeQueryRequest, "debug-node">, "perspective"> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type TrashEvidenceQueryRequest = Omit<
  WithKind<ProtocolTrashEvidenceQueryRequest, "trash-evidence">,
  "perspective"
> &
  Readonly<{ perspective: ProjectionPerspective }>;
export type TrashEvidenceResult = Omit<ProtocolDto<ProtocolTrashEvidence>, "perspective" | "anchor"> &
  Readonly<{ perspective: ProjectionPerspective; anchor: SequenceAnchor | null }>;
export type DebugNodeResult = Omit<
  ProtocolDto<ProtocolDebugNodeResult>,
  "perspective" | "node" | "ownerNodeId" | "metanodeId" | "materializedFields" | "url" | "codeLanguage"
> &
  Readonly<{
    perspective: ProjectionPerspective;
    node: ProjectedNode | null;
    ownerNodeId: string | null;
    metanodeId: string | null;
    materializedFields: readonly MaterializedField[];
    url: string | null;
    codeLanguage: string | null;
  }>;
export type InvocationOutcome = Readonly<{ status: "absent" }> | PublishedResult | CommittedProjectionPendingResult;

export type EngineQueryContract =
  | Readonly<{ query: ProjectionQuery; value: ProjectionPage }>
  | Readonly<{ query: ReviewQueryRequest; value: ReviewQuery }>
  | Readonly<{ query: HistoryQueryRequest; value: HistoryQuery }>
  | Readonly<{ query: InvocationQuery; value: InvocationOutcome }>
  | Readonly<{ query: ConflictQueryRequest; value: ConflictQuery }>
  | Readonly<{ query: SupertagInstancesQueryRequest; value: SupertagInstancesResult }>
  | Readonly<{ query: HardDeletePreviewQuery; value: HardDeletePreview }>
  | Readonly<{ query: BacklinksQueryRequest; value: BacklinksResult }>
  | Readonly<{ query: SearchResultsQueryRequest; value: SearchResultsResult }>
  | Readonly<{ query: ViewRowsQueryRequest; value: ViewRowsResult }>
  | Readonly<{ query: OutlineQueryRequest; value: OutlineResult }>
  | Readonly<{ query: DebugNodeQueryRequest; value: DebugNodeResult }>
  | Readonly<{ query: TrashEvidenceQueryRequest; value: TrashEvidenceResult }>;
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
