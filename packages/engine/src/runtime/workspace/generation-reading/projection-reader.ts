import type { ViewMode } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";
import type { ProjectionSliceName, ProjectionSnapshotReader } from "../../materialization/index.js";
import type { ResolvedGenerationRead } from "./scope-resolver.js";
import { readSection } from "./section-reader.js";

export async function readResolvedProjection(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  resolved: ResolvedGenerationRead,
): Promise<ScopedProjection> {
  const { scope } = resolved;
  const nodesBatch = await store.read(generationId, view, "nodes", [...scope.nodes]);
  const nodes = Object.fromEntries(
    nodesBatch.entries.map((entry) => [entry.identity, entry.value]),
  );
  const [children, addressedValues, schema] = await Promise.all([
    readSection(store, generationId, view, "children", [...scope.children]),
    readSection(store, generationId, view, "addressedValues", [...scope.values]),
    readSchemaProjection(store, generationId, view, scope.nodes, scope.schemas),
  ]);
  return {
    view,
    identity: nodesBatch.identity,
    nodes,
    occurrences: resolved.occurrences,
    children,
    nodeOwners: resolved.nodeOwners,
    addressedValues,
    templateNodeInstances: Object.values(resolved.templateNodeInstances),
    ...schema,
  };
}

async function readSchemaProjection(
  store: ProjectionSnapshotReader,
  generationId: string,
  view: ViewMode,
  nodeIds: ReadonlySet<string>,
  schemaIds: ReadonlySet<string>,
): Promise<
  Pick<
    ScopedProjection,
    | "schemaApplications"
    | "schemaFields"
    | "templateFields"
    | "schemaTemplateNodes"
    | "schemaExtensions"
    | "schemaSearchMembers"
    | "schemaExtensionConflicts"
    | "nodeStatuses"
    | "effectiveFields"
    | "materializedFields"
  >
> {
  const read = <Section extends ProjectionSliceName>(section: Section, ids: readonly string[]) =>
    readSection(store, generationId, view, section, ids);
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
    read("templateFields", schemas),
    read("schemaTemplateNodes", schemas),
    read("schemaExtensions", schemas),
    read("schemaSearchMembers", schemas),
    read("schemaExtensionConflicts", schemas),
    read("nodeStatuses", [...new Set([...schemas, ...nodeIds])]),
    read("effectiveFields", nodes),
    read("materializedFields", nodes),
  ]);
  return {
    schemaApplications: applications,
    schemaFields: fields,
    templateFields: fieldItems,
    schemaTemplateNodes: templateNodes,
    schemaExtensions: extensions,
    schemaSearchMembers: search,
    schemaExtensionConflicts: conflicts,
    nodeStatuses: statuses,
    effectiveFields: effective,
    materializedFields: materialized,
  };
}
