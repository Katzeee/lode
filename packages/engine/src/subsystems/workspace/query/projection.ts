import type {
  ConflictQueryRequest,
  ProjectionPage,
  ProjectionQuery,
  SupertagInstancesQueryRequest,
  SupertagInstancesResult,
} from "@lode/sdk";
import type { ConflictQuery } from "../../../domain/conflict/index.js";
import { stableStringCompare } from "../../../domain/fact/index.js";
import type { Projection, ProjectionSectionName } from "../../../domain/reconcile/index.js";
import type { WorkspaceProjectionState } from "../projection/index.js";

export function queryProjection(query: ProjectionQuery, state: WorkspaceProjectionState): ProjectionPage {
  const section = query.section ?? "nodes";
  const projection = state.generation[query.perspective];
  const page = projectionSectionPage(
    projection,
    state.indexes[query.perspective].sectionIdentities[section],
    section,
    query.after ?? null,
    query.limit ?? 100,
  );
  return {
    identity: state.generation.identity,
    perspective: query.perspective,
    section,
    next: page.next,
    [section]:
      section === "templateNodeInstances"
        ? page.entries.map((entry) => entry.value)
        : Object.fromEntries(page.entries.map((entry) => [entry.identity, entry.value])),
  } as ProjectionPage;
}

export function queryConflicts(query: ConflictQueryRequest, state: WorkspaceProjectionState): ConflictQuery {
  const projection = state.generation.review;
  const page = projectionSectionPage(
    projection,
    state.indexes.review.sectionIdentities.conflictIssues,
    "conflictIssues",
    query.after ?? null,
    query.limit ?? 50,
  );
  return {
    generationId: state.generation.identity.generationId,
    frontier: state.generation.identity.frontier,
    issues: page.entries.map((entry) => entry.value as Projection["conflictIssues"][string]),
    next: page.next,
  };
}

export function querySupertagInstances(
  query: SupertagInstancesQueryRequest,
  state: WorkspaceProjectionState,
): SupertagInstancesResult {
  const nodeIds = state.indexes[query.perspective].lookups.nodeIdsBySupertag.get(query.supertagId) ?? [];
  const page = pageIdentities(nodeIds, query.after ?? null, query.limit ?? 50);
  return {
    generationId: state.generation.identity.generationId,
    frontier: state.generation.identity.frontier,
    perspective: query.perspective,
    supertagId: query.supertagId,
    nodeIds: page.identities,
    next: page.next,
  };
}

function projectionSectionPage<Section extends ProjectionSectionName>(
  projection: Projection,
  identities: readonly string[],
  section: Section,
  after: string | null,
  limit: number,
): Readonly<{ entries: readonly Readonly<{ identity: string; value: unknown }>[]; next: string | null }> {
  const page = pageIdentities(identities, after, limit);
  const sectionValue = projection[section];
  const entries = page.identities.flatMap((identity) => {
    const value =
      section === "templateNodeInstances"
        ? projection.templateNodeInstances[Number(identity)]
        : (sectionValue as Readonly<Record<string, unknown>>)[identity];
    return value === undefined ? [] : [{ identity, value }];
  });
  return { entries, next: page.next };
}

function pageIdentities(
  identities: readonly string[],
  after: string | null,
  limit: number,
): Readonly<{ identities: readonly string[]; next: string | null }> {
  const start = after === null ? 0 : firstIdentityAfter(identities, after);
  const selected = identities.slice(start, start + limit);
  return {
    identities: selected,
    next: start + selected.length < identities.length ? (selected.at(-1) ?? null) : null,
  };
}

function firstIdentityAfter(identities: readonly string[], after: string): number {
  let low = 0;
  let high = identities.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const middleIdentity = identities[middle];
    if (middleIdentity === undefined) {
      throw new Error("Projection identity index is inconsistent");
    }
    if (stableStringCompare(middleIdentity, after) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
