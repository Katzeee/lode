import type { JsonValue } from "../../domain/fact/index.js";
import type {
  ProjectedNode,
  ProjectedOccurrence,
  Projection,
  TemplateNodeInstance,
} from "../../domain/reconcile/index.js";
import type { ProjectionHeader, ShardDescriptor } from "./materialized-generation-format.js";
import { isProjectionIndexSection } from "./materialized-projection-index.js";

export async function loadMaterializedProjection(
  header: ProjectionHeader,
  descriptors: readonly ShardDescriptor[],
  load: (descriptor: ShardDescriptor) => Promise<unknown>,
): Promise<Projection> {
  const projection: Projection = {
    view: header.view,
    identity: header.identity,
    nodes: {},
    occurrences: {},
    children: {},
    nodeOwners: {},
    addressedValues: {},
    schemaApplications: {},
    schemaFields: {},
    templateFields: {},
    schemaTemplateNodes: {},
    templateNodeInstances: [],
    schemaExtensions: {},
    schemaSearchMembers: {},
    schemaExtensionConflicts: {},
    nodeStatuses: {},
    conflictIssues: {},
    effectiveFields: {},
    materializedFields: {},
    reviewScopes: {},
    supportByContribution: {},
  };
  for (const descriptor of descriptors) {
    assignMaterializedValue(projection, descriptor, await load(descriptor));
  }
  return projection;
}

function assignMaterializedValue(
  projection: Projection,
  descriptor: ShardDescriptor,
  value: unknown,
): void {
  if (
    assignTemplateValue(projection, descriptor, value) ||
    isProjectionIndexSection(descriptor.section)
  ) {
    return;
  }
  switch (descriptor.section) {
    case "nodes":
      (projection.nodes as Record<string, ProjectedNode>)[descriptor.identity] =
        value as ProjectedNode;
      break;
    case "occurrences":
      (projection.occurrences as Record<string, ProjectedOccurrence>)[descriptor.identity] =
        value as ProjectedOccurrence;
      break;
    case "children":
      (projection.children as Record<string, readonly string[]>)[descriptor.identity] =
        value as readonly string[];
      break;
    case "nodeOwners":
      (projection.nodeOwners as Record<string, Projection["nodeOwners"][string]>)[
        descriptor.identity
      ] = value as Projection["nodeOwners"][string];
      break;
    case "addressedValues":
      (projection.addressedValues as Record<string, Readonly<Record<string, JsonValue>>>)[
        descriptor.identity
      ] = value as Readonly<Record<string, JsonValue>>;
      break;
    case "schemaApplications":
      (projection.schemaApplications as Record<string, readonly string[]>)[descriptor.identity] =
        value as readonly string[];
      break;
    case "schemaFields":
      (projection.schemaFields as Record<string, readonly string[]>)[descriptor.identity] =
        value as readonly string[];
      break;
    case "templateFields":
      (projection.templateFields as Record<string, Projection["templateFields"][string]>)[
        descriptor.identity
      ] = value as Projection["templateFields"][string];
      break;
    case "schemaTemplateNodes":
    case "templateNodeInstances":
      break;
    case "schemaExtensions":
      (projection.schemaExtensions as Record<string, readonly string[]>)[descriptor.identity] =
        value as readonly string[];
      break;
    case "schemaSearchMembers":
      (projection.schemaSearchMembers as Record<string, readonly string[]>)[descriptor.identity] =
        value as readonly string[];
      break;
    case "schemaExtensionConflicts":
      (projection.schemaExtensionConflicts as Record<string, readonly string[]>)[
        descriptor.identity
      ] = value as readonly string[];
      break;
    case "nodeStatuses":
      (projection.nodeStatuses as Record<string, Projection["nodeStatuses"][string]>)[
        descriptor.identity
      ] = value as Projection["nodeStatuses"][string];
      break;
    case "conflictIssues":
      (projection.conflictIssues as Record<string, Projection["conflictIssues"][string]>)[
        descriptor.identity
      ] = value as Projection["conflictIssues"][string];
      break;
    case "effectiveFields":
      (projection.effectiveFields as Record<string, Projection["effectiveFields"][string]>)[
        descriptor.identity
      ] = value as Projection["effectiveFields"][string];
      break;
    case "materializedFields":
      (projection.materializedFields as Record<string, Projection["materializedFields"][string]>)[
        descriptor.identity
      ] = value as Projection["materializedFields"][string];
      break;
    case "reviewScopes":
      (projection.reviewScopes as Record<string, readonly string[]>)[descriptor.identity] =
        value as readonly string[];
      break;
    case "supportByContribution":
      (projection.supportByContribution as Record<string, readonly string[]>)[descriptor.identity] =
        value as readonly string[];
      break;
  }
}

function assignTemplateValue(
  projection: Projection,
  descriptor: ShardDescriptor,
  value: unknown,
): boolean {
  if (descriptor.section === "schemaTemplateNodes") {
    (projection.schemaTemplateNodes as Record<string, readonly string[]>)[descriptor.identity] =
      value as readonly string[];
    return true;
  }
  if (descriptor.section === "templateNodeInstances") {
    (projection.templateNodeInstances as TemplateNodeInstance[])[Number(descriptor.identity)] =
      value as TemplateNodeInstance;
    return true;
  }
  return false;
}
