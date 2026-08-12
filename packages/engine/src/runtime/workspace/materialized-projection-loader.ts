import type { JsonValue } from "../../domain/fact/index.js";
import type {
  ProjectedNode,
  ProjectedOccurrence,
  Projection,
  TemplateNodeInstance,
} from "../../domain/reconcile/index.js";
import type { ProjectionHeader, ShardDescriptor } from "./materialized-generation-format.js";

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
    canonicalOccurrences: {},
    addressedValues: {},
    schemaApplications: {},
    schemaFields: {},
    schemaFieldItems: {},
    schemaTemplateNodes: {},
    templateNodeInstances: [],
    schemaExtensions: {},
    schemaSearchMembers: {},
    schemaExtensionConflicts: {},
    definitionStatuses: {},
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
  if (assignTemplateValue(projection, descriptor, value)) {
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
    case "canonicalOccurrences":
      (projection.canonicalOccurrences as Record<string, string>)[descriptor.identity] =
        value as string;
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
    case "schemaFieldItems":
      (projection.schemaFieldItems as Record<string, Projection["schemaFieldItems"][string]>)[
        descriptor.identity
      ] = value as Projection["schemaFieldItems"][string];
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
    case "definitionStatuses":
      (projection.definitionStatuses as Record<string, Projection["definitionStatuses"][string]>)[
        descriptor.identity
      ] = value as Projection["definitionStatuses"][string];
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
    case "occurrenceIdsByNode":
    case "nodeIdsBySchema":
    case "nodeIdsByFieldDefinition":
    case "schemaInstanceMemberships":
    case "templateNodeInstancesByOwner":
    case "templateNodeInstancesByTemplate":
    case "templateNodeInstancesByNode":
    case "templateNodeInstancesByOccurrence":
    case "templateNodeInstancesBySchema":
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
