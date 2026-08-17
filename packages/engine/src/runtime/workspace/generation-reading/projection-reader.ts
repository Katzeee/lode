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
  const [
    childOccurrences,
    metanodes,
    workspaceSystemNodes,
    fieldDefinitionConfigurations,
    typedFieldValues,
    searchExpressions,
    sharedDefaultViewDefinitions,
    supertag,
  ] = await Promise.all([
    readSection(store, generationId, perspective, "childOccurrences", [...scope.childOccurrences]),
    readSection(store, generationId, perspective, "metanodes", [...scope.nodes]),
    readSection(store, generationId, perspective, "workspaceSystemNodes", [
      "trash",
      "schema",
      "systemDefinitionCatalog",
    ]),
    readSection(store, generationId, perspective, "fieldDefinitionConfigurations", [...scope.nodes]),
    readSection(store, generationId, perspective, "typedFieldValues", [...scope.nodes]),
    readSection(store, generationId, perspective, "searchExpressions", [...scope.nodes]),
    readSection(store, generationId, perspective, "sharedDefaultViewDefinitions", [...scope.nodes]),
    readSupertagProjection(store, generationId, perspective, scope.nodes, scope.supertags),
  ]);
  const relationNodeIds = Object.values(supertag.templateFields)
    .flat()
    .flatMap((field) => [field.templateFieldNodeId, field.fieldDefinitionId, field.staticDefaultValueNodeId]);
  const relationNodes = await store.read(generationId, perspective, "nodes", relationNodeIds);
  const nodes = Object.fromEntries(
    [...nodesBatch.entries, ...relationNodes.entries].map((entry) => [entry.identity, entry.value]),
  );
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
    typedFieldValues,
    searchExpressions,
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
    | "supertagTemplateNodes"
    | "templateFields"
    | "optionalFieldContributions"
    | "supertagExtensions"
    | "supertagInstanceSupertags"
    | "supertagExtensionConflicts"
    | "materializedFields"
    | "effectiveFields"
    | "optionalFieldSuggestions"
  >
> {
  const read = <Section extends ProjectionSliceName>(section: Section, ids: readonly string[]) =>
    readSection(store, generationId, perspective, section, ids);
  const nodes = [...nodeIds];
  const supertags = [...supertagIds];
  const [
    applications,
    templateNodes,
    templateFields,
    optionalFieldContributions,
    extensions,
    instanceSupertags,
    conflicts,
    materialized,
    effectiveFields,
    optionalFieldSuggestions,
  ] = await Promise.all([
    read("supertagApplications", nodes),
    read("supertagTemplateNodes", supertags),
    read("templateFields", supertags),
    read("optionalFieldContributions", supertags),
    read("supertagExtensions", supertags),
    read("supertagInstanceSupertags", supertags),
    read("supertagExtensionConflicts", supertags),
    read("materializedFields", nodes),
    read("effectiveFields", nodes),
    read("optionalFieldSuggestions", nodes),
  ]);
  return {
    supertagApplications: applications,
    supertagTemplateNodes: templateNodes,
    templateFields,
    optionalFieldContributions,
    supertagExtensions: extensions,
    supertagInstanceSupertags: instanceSupertags,
    supertagExtensionConflicts: conflicts,
    materializedFields: materialized,
    effectiveFields,
    optionalFieldSuggestions,
  };
}
