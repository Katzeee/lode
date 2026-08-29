import type { EngineQuery, EngineQueryValue } from "@lode/sdk";
import type { FactAuthorityPort } from "../authority/authority-contract.js";
import type { WorkspaceProjectionState } from "../projection/index.js";
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

type WorkspaceQueryAuthority = Pick<FactAuthorityPort, "factsOwningActions" | "receipt" | "relatedFactsOwningActions">;

type WorkspaceQueryContext = Readonly<{
  workspaceId: string;
  facts: WorkspaceQueryAuthority;
  state: WorkspaceProjectionState;
  projectionFailure: string | null;
}>;

export async function queryWorkspace(query: EngineQuery, context: WorkspaceQueryContext): Promise<EngineQueryValue> {
  if (query.workspaceId !== context.workspaceId) {
    throw new Error("Query belongs to another Workspace");
  }
  switch (query.kind) {
    case "projection":
      return queryProjection(query, context.state);
    case "conflicts":
      return queryConflicts(query, context.state);
    case "supertag-instances":
      return querySupertagInstances(query, context.state);
    case "backlinks":
      return queryBacklinks(query, context.state.generation);
    case "search-results":
      return querySearchResults(query, context.state.generation);
    case "view-rows":
      return queryViewRows(query, context.state.generation);
    case "outline":
      return queryOutline(query, context.state.generation);
    case "debug-node":
      return queryDebugNode(query, context.state.generation);
    case "trash-evidence":
      return queryTrashEvidence(query, context.state.snapshot, context.state.generation);
    case "review":
      return queryWorkspaceReview(query, context.state.snapshot, context.facts, context.state);
    case "history":
      return queryWorkspaceHistory(query, context.state.snapshot);
    case "invocation":
      return queryWorkspaceInvocation(query, context.facts, context.state, context.projectionFailure);
  }
}
