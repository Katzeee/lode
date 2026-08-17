import type { ProjectionPerspective } from "../../../domain/fact/index.js";
import type { Projection, ScopedProjection } from "../../../domain/reconcile/index.js";
import type { ProjectionSnapshotReader } from "../../materialization/index.js";
import { readIndex } from "./index-reader.js";
import { includeLifecycleScope } from "./lifecycle-scope-rule.js";
import { includeOccurrenceAncestors } from "./occurrence-ancestry-reader.js";
import { includeOwnedDeletionScope } from "./owned-deletion-scope-rule.js";
import { readOwnerClosure } from "./owner-closure-reader.js";
import type { GenerationReadPlan, GenerationReadScope } from "./read-plan.js";
import { readSection } from "./section-reader.js";
import { includeTemplateInstanceScope } from "./template-instance-scope-rule.js";

type TemplateNodeInstance = Projection["templateNodeInstances"][number];

export type ResolvedGenerationRead = Readonly<{
  scope: GenerationReadScope;
  occurrences: ScopedProjection["occurrences"];
  nodeOwners: ScopedProjection["nodeOwners"];
  templateNodeInstances: Readonly<Record<string, TemplateNodeInstance>>;
}>;

export async function resolveGenerationRead(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  plan: GenerationReadPlan,
): Promise<ResolvedGenerationRead> {
  const scope = plan.createScope();
  await includeLifecycleScope(store, generationId, perspective, plan.mutations, scope);
  await includeSupertagAndFieldInstances(store, generationId, perspective, scope);
  const templateNodeInstances = await includeTemplateInstanceScope(store, generationId, perspective, scope);
  await includeChildOccurrenceIds(store, generationId, perspective, scope);
  let occurrences = await readOccurrenceClosure(store, generationId, perspective, scope);
  const nodeOwners = await readNodeOwners(store, generationId, perspective, scope, plan.readsOwnerGraph);
  occurrences = await includeOwnedDeletionScope(
    store,
    generationId,
    perspective,
    plan.mutations,
    occurrences,
    nodeOwners,
    scope,
  );
  return { scope, occurrences, nodeOwners, templateNodeInstances };
}

async function includeChildOccurrenceIds(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  scope: GenerationReadScope,
): Promise<void> {
  const children = await readSection(store, generationId, perspective, "childOccurrences", [...scope.childOccurrences]);
  Object.values(children).forEach((occurrenceIds) =>
    occurrenceIds.forEach((occurrenceId) => scope.occurrences.add(occurrenceId)),
  );
}

async function includeSupertagAndFieldInstances(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  scope: GenerationReadScope,
): Promise<void> {
  const [fieldInstanceNodeIds, supertagInstanceNodeIds] = await Promise.all([
    readIndex(store, generationId, perspective, "nodeIdsByFieldDefinition", [...scope.fields]),
    readIndex(store, generationId, perspective, "nodeIdsBySupertag", [...scope.instanceSupertags]),
  ]);
  fieldInstanceNodeIds.forEach((nodeId) => scope.nodes.add(nodeId));
  supertagInstanceNodeIds.forEach((nodeId) => scope.nodes.add(nodeId));
}

async function readOccurrenceClosure(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  scope: GenerationReadScope,
): Promise<ScopedProjection["occurrences"]> {
  const occurrenceIds = new Set([
    ...scope.occurrences,
    ...(await readIndex(store, generationId, perspective, "occurrenceIdsByNode", [...scope.nodes])),
  ]);
  let occurrences = await readSection(store, generationId, perspective, "occurrences", [...occurrenceIds]);
  includeOccurrenceScope(scope, occurrences);
  const sharedOccurrenceIds = await readIndex(store, generationId, perspective, "occurrenceIdsByNode", [
    ...scope.nodes,
  ]);
  sharedOccurrenceIds.forEach((identity) => occurrenceIds.add(identity));
  occurrences = {
    ...occurrences,
    ...(await readSection(store, generationId, perspective, "occurrences", [...occurrenceIds])),
  };
  occurrences = await includeOccurrenceAncestors(store, generationId, perspective, occurrences);
  includeOccurrenceScope(scope, occurrences);
  return occurrences;
}

async function readNodeOwners(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  scope: GenerationReadScope,
  readsOwnerGraph: boolean,
): Promise<ScopedProjection["nodeOwners"]> {
  if (!readsOwnerGraph) {
    return readSection(store, generationId, perspective, "nodeOwners", [...scope.nodes]);
  }
  const nodeOwners = await readOwnerClosure(store, generationId, perspective, scope.nodes);
  for (const ownerNodeId of Object.values(nodeOwners)) {
    if (typeof ownerNodeId === "string") {
      scope.nodes.add(ownerNodeId);
    }
  }
  return nodeOwners;
}

function includeOccurrenceScope(scope: GenerationReadScope, occurrences: ScopedProjection["occurrences"]): void {
  for (const occurrence of Object.values(occurrences)) {
    scope.nodes.add(occurrence.nodeId);
    scope.nodes.add(occurrence.parentNodeId);
    scope.childOccurrences.add(occurrence.parentNodeId);
  }
}
