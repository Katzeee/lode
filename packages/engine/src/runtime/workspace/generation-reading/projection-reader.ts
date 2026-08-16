import type { ProjectionPerspective } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";
import type { ProjectionSliceName, ProjectionSnapshotReader } from "../../materialization/index.js";
import type { ResolvedGenerationRead } from "./scope-resolver.js";
import { readSection } from "./section-reader.js";

export async function readResolvedProjection(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  resolved: ResolvedGenerationRead,
): Promise<ScopedProjection> {
  const { scope } = resolved;
  const nodesBatch = await store.read(generationId, perspective, "nodes", [...scope.nodes]);
  const nodes = Object.fromEntries(nodesBatch.entries.map((entry) => [entry.identity, entry.value]));
  const [
    childOccurrences,
    metanodes,
    workspaceSystemNodes,
    fieldDefinitionConfigurations,
    searchClauses,
    sharedDefaultViewDefinitions,
    supertag,
  ] = await Promise.all([
    readSection(store, generationId, perspective, "childOccurrences", [...scope.childOccurrences]),
    readSection(store, generationId, perspective, "metanodes", [...scope.nodes]),
    readSection(store, generationId, perspective, "workspaceSystemNodes", ["trash"]),
    readSection(store, generationId, perspective, "fieldDefinitionConfigurations", [...scope.nodes]),
    readSection(store, generationId, perspective, "searchClauses", [...scope.nodes]),
    readSection(store, generationId, perspective, "sharedDefaultViewDefinitions", [...scope.nodes]),
    readSupertagProjection(store, generationId, perspective, scope.nodes, scope.supertags),
  ]);
  return {
    perspective,
    identity: nodesBatch.identity,
    nodes,
    occurrences: resolved.occurrences,
    childOccurrences,
    nodeOwners: resolved.nodeOwners,
    metanodes,
    workspaceSystemNodes,
    fieldDefinitionConfigurations,
    searchClauses,
    sharedDefaultViewDefinitions,
    templateNodeInstances: Object.values(resolved.templateNodeInstances),
    ...supertag,
  };
}

async function readSupertagProjection(
  store: ProjectionSnapshotReader,
  generationId: string,
  perspective: ProjectionPerspective,
  nodeIds: ReadonlySet<string>,
  supertagIds: ReadonlySet<string>,
): Promise<
  Pick<
    ScopedProjection,
    | "supertagApplications"
    | "supertagFields"
    | "templateFields"
    | "supertagTemplateNodes"
    | "supertagExtensions"
    | "supertagInstanceSupertags"
    | "supertagExtensionConflicts"
    | "effectiveFields"
    | "materializedFields"
  >
> {
  const read = <Section extends ProjectionSliceName>(section: Section, ids: readonly string[]) =>
    readSection(store, generationId, perspective, section, ids);
  const nodes = [...nodeIds];
  const supertags = [...supertagIds];
  const [
    applications,
    fields,
    fieldItems,
    templateNodes,
    extensions,
    instanceSupertags,
    conflicts,
    effective,
    materialized,
  ] = await Promise.all([
    read("supertagApplications", nodes),
    read("supertagFields", supertags),
    read("templateFields", supertags),
    read("supertagTemplateNodes", supertags),
    read("supertagExtensions", supertags),
    read("supertagInstanceSupertags", supertags),
    read("supertagExtensionConflicts", supertags),
    read("effectiveFields", nodes),
    read("materializedFields", nodes),
  ]);
  return {
    supertagApplications: applications,
    supertagFields: fields,
    templateFields: fieldItems,
    supertagTemplateNodes: templateNodes,
    supertagExtensions: extensions,
    supertagInstanceSupertags: instanceSupertags,
    supertagExtensionConflicts: conflicts,
    effectiveFields: effective,
    materializedFields: materialized,
  };
}
