import type {
  ConflictQueryRequest,
  ProjectionQuery,
  SchemaSearchQueryRequest,
  SchemaSearchResult,
} from "../../../application/contract.js";
import type { ConflictQuery } from "../../../domain/conflict/index.js";
import type {
  ProjectionPageReader,
  ProjectionSchemaSearchReader,
} from "../../materialization/index.js";

export function queryProjection(
  query: ProjectionQuery,
  generationId: string,
  projections: ProjectionPageReader,
) {
  return projections.page(generationId, query);
}

export async function queryConflicts(
  workspaceId: string,
  query: ConflictQueryRequest,
  generationId: string,
  projections: ProjectionPageReader,
): Promise<ConflictQuery> {
  const page = await projections.page(generationId, {
    kind: "projection",
    workspaceId,
    view: "review",
    section: "conflictIssues",
    after: query.after,
    limit: query.limit,
  });
  if (page.section !== "conflictIssues") {
    throw new Error("Conflict query received another Projection section");
  }
  return {
    generationId: page.identity.generationId,
    frontier: page.identity.frontier,
    issues: Object.values(page.conflictIssues),
    next: page.next,
  };
}

export async function querySchemaSearch(
  query: SchemaSearchQueryRequest,
  generationId: string,
  projections: ProjectionSchemaSearchReader,
): Promise<SchemaSearchResult> {
  const page = await projections.schemaSearch(
    generationId,
    query.view,
    query.schemaId,
    query.after ?? null,
    query.limit ?? 50,
  );
  return {
    generationId: page.identity.generationId,
    frontier: page.identity.frontier,
    view: query.view,
    schemaId: query.schemaId,
    nodeIds: page.nodeIds,
    next: page.next,
  };
}
