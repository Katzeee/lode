import type { ReviewQueryRequest } from "../../application/contract.js";
import {
  stableStringCompare,
  type ContributionFact,
  type FactSnapshot,
  type Mutation,
  type ViewMode,
} from "../../domain/fact/index.js";
import { pendingProposalFacts } from "../../domain/review/evidence.js";
import { reviewPaginationScopes } from "../../domain/review/index.js";
import { type Projection, type ProjectionGeneration } from "../../domain/reconcile/index.js";
import type { ProjectionGenerationStore } from "./proposal-workspace-types.js";
import {
  isManagedChild,
  isProjectedOccurrence,
  mutationReadScope,
  type MutationReadScope,
} from "./mutation-read-scope.js";

export async function readMutationGeneration(
  store: ProjectionGenerationStore,
  generationId: string,
  mutations: readonly Mutation[],
): Promise<ProjectionGeneration> {
  return store.withReadLease(generationId, async () => {
    const origin = await readView(store, generationId, "origin", mutations);
    const review = await readView(store, generationId, "review", mutations);
    return {
      identity: origin.identity,
      origin,
      review,
      ownerCaches: {
        origin: { activeContributionIds: [], supportPasses: 0 },
        review: { activeContributionIds: [], supportPasses: 0 },
      },
    };
  });
}

export type ReviewGenerationPage = Readonly<{
  generation: ProjectionGeneration;
  pending: ReadonlyMap<string, ContributionFact>;
  next: string | null;
}>;

export async function readReviewGeneration(
  store: ProjectionGenerationStore,
  generationId: string,
  snapshot: FactSnapshot,
  query: ReviewQueryRequest,
): Promise<ReviewGenerationPage> {
  const pending = pendingProposalFacts(snapshot);
  const byScope = reviewPaginationScopes(pending, snapshot.facts);
  const allKeys = [...byScope.keys()].sort(stableStringCompare);
  const after = query.after ?? null;
  const remaining =
    after === null ? allKeys : allKeys.filter((key) => stableStringCompare(key, after) > 0);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const selectedKeys = remaining.slice(0, limit);
  const selectedFacts = selectedKeys.flatMap((key) => byScope.get(key) ?? []);
  return {
    generation: await readMutationGeneration(
      store,
      generationId,
      selectedFacts.map((fact) => fact.body.mutation),
    ),
    pending: new Map(selectedFacts.map((fact) => [fact.id, fact])),
    next: remaining.length > selectedKeys.length ? (selectedKeys.at(-1) ?? null) : null,
  };
}

export function readFactGeneration(
  store: ProjectionGenerationStore,
  generationId: string,
  snapshot: FactSnapshot,
  factIds: readonly string[],
): Promise<ProjectionGeneration> {
  const selected = new Set(factIds);
  return readMutationGeneration(
    store,
    generationId,
    snapshot.facts.flatMap((fact) =>
      selected.has(fact.id) && fact.body.kind === "contribution" ? [fact.body.mutation] : [],
    ),
  );
}

async function readView(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  mutations: readonly Mutation[],
): Promise<Projection> {
  const wanted = mutationReadScope(mutations);
  const schemaInstanceNodeIds = await readIndex(store, generationId, view, "nodeIdsBySchema", [
    ...wanted.instanceSchemas,
  ]);
  schemaInstanceNodeIds.forEach((nodeId) => wanted.nodes.add(nodeId));
  const managedIds = await managedChildIds(store, generationId, view, wanted);
  const managedChildren = await readSection(
    store,
    generationId,
    view,
    "managedChildren",
    managedIds,
  );
  for (const value of Object.values(managedChildren)) {
    if (isManagedChild(value)) {
      wanted.nodes.add(value.nodeId);
      wanted.occurrences.add(value.occurrenceId);
    }
  }
  const occurrenceIds = new Set([
    ...wanted.occurrences,
    ...(await readIndex(store, generationId, view, "occurrenceIdsByNode", [...wanted.nodes])),
  ]);
  let occurrences = await readSection(store, generationId, view, "occurrences", [...occurrenceIds]);
  for (const occurrence of Object.values(occurrences)) {
    if (isProjectedOccurrence(occurrence)) {
      wanted.nodes.add(occurrence.nodeId);
      wanted.children.add(occurrence.parentOccurrenceId ?? "$root");
    }
  }
  const sharedOccurrenceIds = await readIndex(store, generationId, view, "occurrenceIdsByNode", [
    ...wanted.nodes,
  ]);
  for (const identity of sharedOccurrenceIds) {
    occurrenceIds.add(identity);
  }
  occurrences = {
    ...occurrences,
    ...(await readSection(store, generationId, view, "occurrences", [...occurrenceIds])),
  };
  occurrences = await includeOccurrenceAncestors(store, generationId, view, occurrences);
  for (const occurrence of Object.values(occurrences)) {
    if (isProjectedOccurrence(occurrence)) {
      wanted.nodes.add(occurrence.nodeId);
      wanted.children.add(occurrence.parentOccurrenceId ?? "$root");
    }
  }
  const nodesBatch = await store.read(generationId, view, "nodes", [...wanted.nodes]);
  const nodes = Object.fromEntries(
    nodesBatch.entries.map((entry) => [entry.identity, entry.value]),
  );
  const children = await readSection(store, generationId, view, "children", [...wanted.children]);
  const canonicalOccurrences = await readSection(
    store,
    generationId,
    view,
    "canonicalOccurrences",
    [...wanted.nodes],
  );
  const addressedValues = await readSection(store, generationId, view, "addressedValues", [
    ...wanted.values,
  ]);
  const schema = await readSchemaProjection(
    store,
    generationId,
    view,
    wanted.nodes,
    wanted.schemas,
  );
  return {
    view,
    identity: nodesBatch.identity,
    nodes: nodes as Projection["nodes"],
    occurrences: occurrences as Projection["occurrences"],
    children: children as Projection["children"],
    canonicalOccurrences: canonicalOccurrences as Projection["canonicalOccurrences"],
    addressedValues: addressedValues as Projection["addressedValues"],
    managedChildren: Object.values(managedChildren) as Projection["managedChildren"],
    ...schema,
  };
}

async function readSchemaProjection(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  nodeIds: ReadonlySet<string>,
  schemaIds: ReadonlySet<string>,
): Promise<
  Pick<
    Projection,
    | "schemaApplications"
    | "schemaFields"
    | "schemaFieldItems"
    | "schemaExtensions"
    | "schemaSearchMembers"
    | "schemaExtensionConflicts"
    | "conflictIssues"
    | "effectiveFields"
    | "materializedFields"
  >
> {
  const read = (
    section: Parameters<ProjectionGenerationStore["read"]>[2],
    ids: readonly string[],
  ) => readSection(store, generationId, view, section, ids);
  const nodes = [...nodeIds];
  const schemas = [...schemaIds];
  const [applications, fields, fieldItems, extensions, search, conflicts, effective, materialized] =
    await Promise.all([
      read("schemaApplications", nodes),
      read("schemaFields", schemas),
      read("schemaFieldItems", schemas),
      read("schemaExtensions", schemas),
      read("schemaSearchMembers", schemas),
      read("schemaExtensionConflicts", schemas),
      read("effectiveFields", nodes),
      read("materializedFields", nodes),
    ]);
  return {
    schemaApplications: applications as Projection["schemaApplications"],
    schemaFields: fields as Projection["schemaFields"],
    schemaFieldItems: fieldItems as Projection["schemaFieldItems"],
    schemaExtensions: extensions as Projection["schemaExtensions"],
    schemaSearchMembers: search as Projection["schemaSearchMembers"],
    schemaExtensionConflicts: conflicts as Projection["schemaExtensionConflicts"],
    conflictIssues: {},
    effectiveFields: effective as Projection["effectiveFields"],
    materializedFields: materialized as Projection["materializedFields"],
  };
}

async function readSection(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  section: Parameters<ProjectionGenerationStore["read"]>[2],
  identities: readonly string[],
): Promise<Record<string, unknown>> {
  const batch = await store.read(generationId, view, section, [...new Set(identities)]);
  return Object.fromEntries(batch.entries.map((entry) => [entry.identity, entry.value]));
}

async function readIndex(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  section: Parameters<ProjectionGenerationStore["read"]>[2],
  identities: readonly string[],
): Promise<readonly string[]> {
  const values = await readSection(store, generationId, view, section, identities);
  return Object.values(values).flatMap((value) =>
    Array.isArray(value)
      ? value.filter((identity): identity is string => typeof identity === "string")
      : [],
  );
}

async function includeOccurrenceAncestors(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  initial: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const occurrences = { ...initial };
  const visited = new Set(Object.keys(occurrences));
  let frontier = parentIds(Object.values(occurrences));
  const maximumDepth = 4_096;
  for (let depth = 0; frontier.length > 0; depth += 1) {
    if (depth >= maximumDepth) {
      throw new Error("Occurrence ancestry exceeds the state-dependent read bound");
    }
    const wanted = frontier.filter((identity) => !visited.has(identity));
    if (wanted.length === 0) {
      break;
    }
    wanted.forEach((identity) => visited.add(identity));
    const parents = await readSection(store, generationId, view, "occurrences", wanted);
    Object.assign(occurrences, parents);
    frontier = parentIds(Object.values(parents));
  }
  return occurrences;
}

function parentIds(values: readonly unknown[]): string[] {
  return values.flatMap((value) =>
    isProjectedOccurrence(value) && value.parentOccurrenceId !== null
      ? [value.parentOccurrenceId]
      : [],
  );
}

async function managedChildIds(
  store: ProjectionGenerationStore,
  generationId: string,
  view: ViewMode,
  wanted: MutationReadScope,
): Promise<readonly string[]> {
  const groups = await Promise.all([
    readIndex(store, generationId, view, "managedChildrenByParentNode", [...wanted.nodes]),
    readIndex(store, generationId, view, "managedChildrenBySchema", [...wanted.schemas]),
    readIndex(store, generationId, view, "managedChildrenByField", [...wanted.fields]),
    readIndex(store, generationId, view, "managedChildrenByNode", [...wanted.nodes]),
    readIndex(store, generationId, view, "managedChildrenByOccurrence", [...wanted.occurrences]),
  ]);
  return [...new Set(groups.flat())];
}
