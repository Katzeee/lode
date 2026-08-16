import type {
  ConflictQueryRequest,
  ProjectionPage,
  ProjectionPageSection,
  ProjectionQuery,
  SupertagInstancesQueryRequest,
  SupertagInstancesResult,
} from "@lode/sdk";
import type { ConflictQuery } from "../../../domain/conflict/index.js";
import type { ProjectionIdentity, ProjectionPerspective } from "../../../domain/fact/index.js";
import type {
  ProjectionSupertagInstancesReader,
  ProjectionSectionPageReader,
  ProjectionSlicePage,
} from "../../materialization/index.js";

export async function queryProjection(
  query: ProjectionQuery,
  generationId: string,
  projections: ProjectionSectionPageReader,
): Promise<ProjectionPage> {
  const section = query.section ?? "nodes";
  const page = await projections.page(
    generationId,
    query.perspective,
    section,
    query.after ?? null,
    query.limit ?? 100,
  );
  return projectionPage(page.identity, query.perspective, section, page.next, page.entries);
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

export async function querySupertagInstances(
  query: SupertagInstancesQueryRequest,
  generationId: string,
  projections: ProjectionSupertagInstancesReader,
): Promise<SupertagInstancesResult> {
  const page = await projections.supertagInstances(
    generationId,
    query.perspective,
    query.supertagId,
    query.after ?? null,
    query.limit ?? 50,
  );
  return {
    generationId: page.identity.generationId,
    frontier: page.identity.frontier,
    perspective: query.perspective,
    supertagId: query.supertagId,
    nodeIds: page.nodeIds,
    next: page.next,
  };
}

function projectionPage<Section extends ProjectionPageSection>(
  identity: ProjectionIdentity,
  perspective: ProjectionPerspective,
  section: Section,
  next: string | null,
  entries: ProjectionSlicePage<Section>["entries"],
): ProjectionPage<Section> {
  const value =
    section === "templateNodeInstances"
      ? entries.map((entry) => entry.value)
      : Object.fromEntries(entries.map((entry) => [entry.identity, entry.value]));
  return { identity, perspective, section, next, [section]: value } as ProjectionPage<Section>;
}
