import type { EngineQuery, EngineQueryValue } from "@lode/sdk";
import type { FactSnapshot } from "../../../domain/fact/index.js";
import type { FactAuthority } from "../../authority/fact-authority.js";
import type {
  ProjectionIdentityReader,
  ProjectionGenerationReader,
  ProjectionSectionPageReader,
  ReviewReadModelReader,
  ProjectionSupertagInstancesReader,
  ProjectionSnapshotReader,
} from "../../materialization/index.js";
import { hardDeletePreview } from "../hard-delete.js";
import { queryWorkspaceHistory } from "./history.js";
import { queryWorkspaceInvocation } from "./invocation.js";
import { queryConflicts, queryProjection, querySupertagInstances } from "./projection.js";
import { queryWorkspaceReview } from "./review.js";
import { queryBacklinks } from "./backlinks.js";
import { querySearchResults } from "./search-results.js";
import { queryViewRows } from "./view-rows.js";
import { queryOutline } from "./outline.js";
import { queryDebugNode } from "./debug-node.js";
import { queryTrashEvidence } from "./trash-evidence.js";

type WorkspaceQueryProjectionReader = ProjectionIdentityReader &
  ProjectionGenerationReader &
  ProjectionSectionPageReader &
  ReviewReadModelReader &
  ProjectionSupertagInstancesReader &
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

export function queryWorkspace(query: EngineQuery, context: WorkspaceQueryContext): Promise<EngineQueryValue> {
  if (query.workspaceId !== context.workspaceId) {
    throw new Error("Query belongs to another Workspace");
  }
  switch (query.kind) {
    case "projection":
      return queryProjection(query, context.generationId, context.projections);
    case "conflicts":
      return queryConflicts(query, context.generationId, context.projections);
    case "supertag-instances":
      return querySupertagInstances(query, context.generationId, context.projections);
    case "backlinks":
      return queryBacklinks(query, context.generationId, context.projections);
    case "search-results":
      return querySearchResults(query, context.generationId, context.projections);
    case "view-rows":
      return queryViewRows(query, context.generationId, context.projections);
    case "outline":
      return queryOutline(query, context.generationId, context.projections);
    case "debug-node":
      return queryDebugNode(query, context.generationId, context.projections);
    case "trash-evidence":
      return queryTrashEvidence(query, context.generationId, context.snapshot, context.projections);
    case "hard-delete-preview":
      return hardDeletePreview(
        context.workspaceId,
        query.nodeId,
        context.snapshot,
        context.facts,
        context.projections,
        context.generationId,
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
      return queryWorkspaceHistory(query, context.snapshot, context.facts, context.projections, context.generationId);
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
