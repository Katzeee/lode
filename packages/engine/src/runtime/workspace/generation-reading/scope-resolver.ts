import type { ViewMode } from "../../../domain/fact/index.js";
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
  view: ViewMode,
  plan: GenerationReadPlan,
): Promise<ResolvedGenerationRead> {
  const scope = plan.createScope();
  await includeLifecycleScope(store, generationId, view, plan.mutations, scope);
  await includeSchemaAndFieldInstances(store, generationId, view, scope);
  const templateNodeInstances = await includeTemplateInstanceScope(
    store,
    generationId,
    view,
    scope,
  );
  let occurrences = await readOccurrenceClosure(store, generationId, view, scope);
  const nodeOwners = await readNodeOwners(store, generationId, view, scope, plan.readsOwnerGraph);
  occurrences = await includeOwnedDeletionScope(
    store,
    generationId,
    view,
    plan.mutations,
    occurrences,
    nodeOwners,
    scope,
  );
  return { scope, occurrences, nodeOwners, templateNodeInstances };
}

async function includeSchemaAndFieldInstances(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  scope: GenerationReadScope,
): Promise<void> {
  const [fieldInstanceNodeIds, schemaInstanceNodeIds] = await Promise.all([
    readIndex(store, generationId, view, "nodeIdsByFieldDefinition", [...scope.fields]),
    readIndex(store, generationId, view, "nodeIdsBySchema", [...scope.instanceSchemas]),
  ]);
  fieldInstanceNodeIds.forEach((nodeId) => scope.nodes.add(nodeId));
  schemaInstanceNodeIds.forEach((nodeId) => scope.nodes.add(nodeId));
}

async function readOccurrenceClosure(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  scope: GenerationReadScope,
): Promise<ScopedProjection["occurrences"]> {
  const occurrenceIds = new Set([
    ...scope.occurrences,
    ...(await readIndex(store, generationId, view, "occurrenceIdsByNode", [...scope.nodes])),
  ]);
  let occurrences = await readSection(store, generationId, view, "occurrences", [...occurrenceIds]);
  includeOccurrenceScope(scope, occurrences);
  const sharedOccurrenceIds = await readIndex(store, generationId, view, "occurrenceIdsByNode", [
    ...scope.nodes,
  ]);
  sharedOccurrenceIds.forEach((identity) => occurrenceIds.add(identity));
  occurrences = {
    ...occurrences,
    ...(await readSection(store, generationId, view, "occurrences", [...occurrenceIds])),
  };
  occurrences = await includeOccurrenceAncestors(store, generationId, view, occurrences);
  includeOccurrenceScope(scope, occurrences);
  return occurrences;
}

async function readNodeOwners(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  scope: GenerationReadScope,
  readsOwnerGraph: boolean,
): Promise<ScopedProjection["nodeOwners"]> {
  if (!readsOwnerGraph) {
    return readSection(store, generationId, view, "nodeOwners", [...scope.nodes]);
  }
  const nodeOwners = await readOwnerClosure(store, generationId, view, scope.nodes);
  for (const ownerNodeId of Object.values(nodeOwners)) {
    if (typeof ownerNodeId === "string") {
      scope.nodes.add(ownerNodeId);
    }
  }
  return nodeOwners;
}

function includeOccurrenceScope(
  scope: GenerationReadScope,
  occurrences: ScopedProjection["occurrences"],
): void {
  for (const occurrence of Object.values(occurrences)) {
    scope.nodes.add(occurrence.nodeId);
    scope.nodes.add(occurrence.parentNodeId);
    scope.children.add(occurrence.parentNodeId);
  }
}
