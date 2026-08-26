import type { EngineQuery, EngineQueryValue } from "@lode/sdk";
import type { FactSnapshot } from "../../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import type {
  ProjectionIdentityReader,
  ProjectionSectionPageReader,
  ReviewReadModelReader,
  ProjectionSupertagInstancesReader,
  ProjectionSnapshotReader,
} from "../projection/index.js";
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
  ProjectionSectionPageReader &
  ReviewReadModelReader &
  ProjectionSupertagInstancesReader &
  ProjectionSnapshotReader;

type WorkspaceQueryAuthority = Pick<
  FactAuthorityPort,
  "factsOwningActions" | "receipt" | "receiptsForChannel" | "relatedFactsOwningActions"
>;

type WorkspaceQueryContext = Readonly<{
  workspaceId: string;
  facts: WorkspaceQueryAuthority;
  snapshot: FactSnapshot;
  generation: ProjectionGeneration;
  projections: WorkspaceQueryProjectionReader;
  generationId: string;
  projectionFailure: string | null;
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
      return Promise.resolve(queryBacklinks(query, context.generation));
    case "search-results":
      return Promise.resolve(querySearchResults(query, context.generation));
    case "view-rows":
      return Promise.resolve(queryViewRows(query, context.generation));
    case "outline":
      return Promise.resolve(queryOutline(query, context.generation));
    case "debug-node":
      return Promise.resolve(queryDebugNode(query, context.generation));
    case "trash-evidence":
      return Promise.resolve(queryTrashEvidence(query, context.snapshot, context.generation));
    case "review":
      return queryWorkspaceReview(query, context.snapshot, context.facts, context.projections, context.generationId);
    case "history":
      return queryWorkspaceHistory(query, context.snapshot, context.facts);
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
