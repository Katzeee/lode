import type { ReviewQueryRequest } from "../../application/contract.js";
import {
  type ContributionFact,
  type FactSnapshot,
  type Mutation,
  type ViewMode,
} from "../../domain/fact/index.js";
import { type Projection, type ProjectionGeneration } from "../../domain/reconcile/index.js";
import type {
  ProjectionGenerationStore,
  ReviewGenerationPage,
} from "./proposal-workspace-types.js";
import { isProjectedOccurrence, mutationReadScope } from "./mutation-read-scope.js";
import {
  readTemplateNodeInstances,
  templateNodeInstancesOf,
} from "./template-node-generation-reader.js";
import { readIndex } from "./mutation-generation-index-reader.js";
import type { FactStore } from "../authority/fact-store.js";
import { expandLifecycleReadScope } from "./lifecycle-generation-reader.js";

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
        origin: { activeContributionIds: [], supportByContribution: {}, supportPasses: 0 },
        review: { activeContributionIds: [], supportByContribution: {}, supportPasses: 0 },
      },
    };
  });
}

export async function readReviewGeneration(
  store: ProjectionGenerationStore,
  generationId: string,
  query: ReviewQueryRequest,
  facts: FactStore,
): Promise<ReviewGenerationPage> {
  const after = query.after ?? null;
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const scopePage = await store.reviewScopes(generationId, after, limit);
  const selectedIds = scopePage.scopes.flatMap((scope) => scope.contributionIds);
  const selectedFacts = facts
    .facts(selectedIds)
    .filter(
      (fact): fact is ContributionFact =>
        fact.body.kind === "contribution" && fact.body.intent === "proposal",
    );
  const selectedPending = new Map(selectedFacts.map((fact) => [fact.id, fact]));
  const supportBatch = await store.read(
    generationId,
    "review",
    "supportByContribution",
    selectedIds,
  );
  const supportByContribution = new Map(
    supportBatch.entries.map((entry) => [entry.identity, entry.value as readonly string[]]),
  );
  return {
    generation: await readMutationGeneration(
      store,
      generationId,
      selectedFacts.map((fact) => fact.body.mutation),
    ),
    pending: selectedPending,
    context: { pending: selectedPending, supportByContribution },
    facts: facts.relatedFacts(selectedFacts.map((fact) => fact.id)),
    next: scopePage.next,
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
  await expandLifecycleReadScope(store, generationId, view, mutations, wanted);
  const fieldInstanceNodeIds = await readIndex(
    store,
    generationId,
    view,
    "nodeIdsByFieldDefinition",
    [...wanted.fields],
  );
  fieldInstanceNodeIds.forEach((nodeId) => wanted.nodes.add(nodeId));
  const schemaInstanceNodeIds = await readIndex(store, generationId, view, "nodeIdsBySchema", [
    ...wanted.instanceSchemas,
  ]);
  schemaInstanceNodeIds.forEach((nodeId) => wanted.nodes.add(nodeId));
  const templateNodeInstances = await readTemplateNodeInstances(store, generationId, view, wanted);
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
    templateNodeInstances: templateNodeInstancesOf(templateNodeInstances),
    ...schema,
    reviewScopes: {},
    supportByContribution: {},
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
    | "schemaTemplateNodes"
    | "schemaExtensions"
    | "schemaSearchMembers"
    | "schemaExtensionConflicts"
    | "definitionStatuses"
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
  const [
    applications,
    fields,
    fieldItems,
    templateNodes,
    extensions,
    search,
    conflicts,
    statuses,
    effective,
    materialized,
  ] = await Promise.all([
    read("schemaApplications", nodes),
    read("schemaFields", schemas),
    read("schemaFieldItems", schemas),
    read("schemaTemplateNodes", schemas),
    read("schemaExtensions", schemas),
    read("schemaSearchMembers", schemas),
    read("schemaExtensionConflicts", schemas),
    read("definitionStatuses", [...new Set([...schemas, ...nodeIds])]),
    read("effectiveFields", nodes),
    read("materializedFields", nodes),
  ]);
  return {
    schemaApplications: applications as Projection["schemaApplications"],
    schemaFields: fields as Projection["schemaFields"],
    schemaFieldItems: fieldItems as Projection["schemaFieldItems"],
    schemaTemplateNodes: templateNodes as Projection["schemaTemplateNodes"],
    schemaExtensions: extensions as Projection["schemaExtensions"],
    schemaSearchMembers: search as Projection["schemaSearchMembers"],
    schemaExtensionConflicts: conflicts as Projection["schemaExtensionConflicts"],
    definitionStatuses: statuses as Projection["definitionStatuses"],
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
