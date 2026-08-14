import type { EngineQuery, EngineQueryValue } from "../../../application/contract.js";
import type { FactSnapshot } from "../../../domain/fact/index.js";
import type { FactAuthority } from "../../authority/fact-authority.js";
import type {
  ProjectionIdentityReader,
  ProjectionPageReader,
  ReviewReadModelReader,
  ProjectionSchemaSearchReader,
  ProjectionSnapshotReader,
} from "../../materialization/index.js";
import { hardDeletePreview } from "../hard-delete.js";
import { queryWorkspaceHistory } from "./history.js";
import { queryWorkspaceInvocation } from "./invocation.js";
import { queryConflicts, queryProjection, querySchemaSearch } from "./projection.js";
import { queryWorkspaceReview } from "./review.js";
import { readView } from "./view.js";

type WorkspaceQueryProjectionReader = ProjectionIdentityReader &
  ProjectionPageReader &
  ReviewReadModelReader &
  ProjectionSchemaSearchReader &
  ProjectionSnapshotReader;

type WorkspaceQueryAuthority = Pick<
  FactAuthority,
  | "facts"
  | "historyImpacts"
  | "receipt"
  | "receiptsForChannel"
  | "relatedFacts"
  | "replicaId"
  | "settleInvocation"
  | "uncertainInvocations"
>;

type WorkspaceQueryContext = Readonly<{
  workspaceId: string;
  facts: WorkspaceQueryAuthority;
  snapshot: FactSnapshot;
  projections: WorkspaceQueryProjectionReader;
  generationId: string;
  projectionFailure: string | null;
  reviewCapabilityKey?: string;
}>;

export function queryWorkspace(
  query: EngineQuery,
  context: WorkspaceQueryContext,
): Promise<EngineQueryValue> {
  if (query.workspaceId !== context.workspaceId) {
    throw new Error("Query belongs to another Workspace");
  }
  switch (query.kind) {
    case "projection":
      return queryProjection(query, context.generationId, context.projections);
    case "conflicts":
      return queryConflicts(context.workspaceId, query, context.generationId, context.projections);
    case "schema-search":
      return querySchemaSearch(query, context.generationId, context.projections);
    case "view":
      return readView(
        context.projections,
        context.generationId,
        query.view,
        query.viewNodeId,
        query.after ?? null,
        query.limit ?? 50,
      );
    case "hard-delete-preview":
      return Promise.resolve(
        hardDeletePreview(
          context.workspaceId,
          query.nodeId,
          context.snapshot,
          context.facts,
          context.generationId,
        ),
      );
    case "review":
      return queryWorkspaceReview(
        context.workspaceId,
        query,
        context.snapshot,
        context.facts,
        context.projections,
        context.generationId,
        context.reviewCapabilityKey,
      );
    case "history":
      return queryWorkspaceHistory(
        query,
        context.snapshot,
        context.facts,
        context.projections,
        context.generationId,
      );
    case "invocation":
      return queryWorkspaceInvocation(
        query,
        context.facts,
        context.projections,
        context.generationId,
        context.projectionFailure,
      );
  }
}
