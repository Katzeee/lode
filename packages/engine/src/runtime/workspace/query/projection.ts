import type {
  ConflictQueryRequest,
  ProjectionPage,
  ProjectionPageSection,
  ProjectionQuery,
  SchemaSearchQueryRequest,
  SchemaSearchResult,
} from "@lode/sdk";
import type { ConflictQuery } from "../../../domain/conflict/index.js";
import type { ProjectionIdentity, ViewMode } from "../../../domain/fact/index.js";
import type {
  ProjectionSchemaSearchReader,
  ProjectionSectionPageReader,
  ProjectionSlicePage,
} from "../../materialization/index.js";

export async function queryProjection(
  query: ProjectionQuery,
  generationId: string,
  projections: ProjectionSectionPageReader,
): Promise<ProjectionPage> {
  const section = query.section ?? "nodes";
  const page = await projections.page(generationId, query.view, section, query.after ?? null, query.limit ?? 100);
  return projectionPage(page.identity, query.view, section, page.next, page.entries);
}

export async function queryConflicts(
  query: ConflictQueryRequest,
  generationId: string,
  projections: ProjectionSectionPageReader,
): Promise<ConflictQuery> {
  const page = await projections.page(generationId, "review", "conflictIssues", query.after ?? null, query.limit ?? 50);
  return {
    generationId: page.identity.generationId,
    frontier: page.identity.frontier,
    issues: page.entries.map((entry) => entry.value),
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

function projectionPage<Section extends ProjectionPageSection>(
  identity: ProjectionIdentity,
  view: ViewMode,
  section: Section,
  next: string | null,
  entries: ProjectionSlicePage<Section>["entries"],
): ProjectionPage<Section> {
  const value =
    section === "templateNodeInstances"
      ? entries.map((entry) => entry.value)
      : Object.fromEntries(entries.map((entry) => [entry.identity, entry.value]));
  return { identity, view, section, next, [section]: value } as ProjectionPage<Section>;
}
