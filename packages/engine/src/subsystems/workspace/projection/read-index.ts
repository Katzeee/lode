import { stableStringCompare, type ProjectionPerspective } from "../../../domain/fact/index.js";
import {
  PROJECTION_SECTION_NAMES,
  type Projection,
  type ProjectionGeneration,
  type ProjectionSectionName,
} from "../../../domain/reconcile/index.js";

export const PROJECTION_LOOKUP_INDEX_NAMES = [
  "occurrenceIdsByNode",
  "nodeIdsByOwner",
  "nodeIdsBySupertag",
  "nodeIdsByFieldDefinition",
  "templateNodeInstancesByOwner",
  "templateNodeInstancesByTemplate",
  "templateNodeInstancesByNode",
  "templateNodeInstancesByOccurrence",
  "templateNodeInstancesBySupertag",
] as const;

export type ProjectionLookupIndexName = (typeof PROJECTION_LOOKUP_INDEX_NAMES)[number];

export type ProjectionReadIndex = Readonly<{
  sectionIdentities: Readonly<Record<ProjectionSectionName, readonly string[]>>;
  lookups: Readonly<Record<ProjectionLookupIndexName, ReadonlyMap<string, readonly string[]>>>;
}>;

export type ProjectionGenerationReadIndexes = Readonly<Record<ProjectionPerspective, ProjectionReadIndex>>;

export function createProjectionReadIndexes(generation: ProjectionGeneration): ProjectionGenerationReadIndexes {
  return {
    origin: createProjectionReadIndex(generation.origin),
    review: createProjectionReadIndex(generation.review),
  };
}

function createProjectionReadIndex(projection: Projection): ProjectionReadIndex {
  const lookups = Object.fromEntries(
    PROJECTION_LOOKUP_INDEX_NAMES.map((name) => [name, new Map<string, Set<string>>()]),
  ) as Record<ProjectionLookupIndexName, Map<string, Set<string>>>;
  const add = (name: ProjectionLookupIndexName, identity: string, value: string) => {
    const values = lookups[name].get(identity) ?? new Set<string>();
    values.add(value);
    lookups[name].set(identity, values);
  };

  for (const occurrence of Object.values(projection.occurrences)) {
    add("occurrenceIdsByNode", occurrence.nodeId, occurrence.occurrenceId);
  }
  for (const [nodeId, ownerNodeId] of Object.entries(projection.nodeOwners)) {
    if (ownerNodeId !== null) {
      add("nodeIdsByOwner", ownerNodeId, nodeId);
    }
  }
  for (const [nodeId, applications] of Object.entries(projection.supertagApplications)) {
    const appliedSupertagIds = applications.map((application) => application.supertagId);
    for (const [requestedSupertagId, instanceSupertagIds] of Object.entries(projection.supertagInstanceSupertags)) {
      if (appliedSupertagIds.some((supertagId) => instanceSupertagIds.includes(supertagId))) {
        add("nodeIdsBySupertag", requestedSupertagId, nodeId);
      }
    }
    for (const supertagId of appliedSupertagIds.filter(
      (supertagId) => projection.supertagInstanceSupertags[supertagId] === undefined,
    )) {
      add("nodeIdsBySupertag", supertagId, nodeId);
    }
  }
  for (const [nodeId, fields] of Object.entries(projection.materializedFields)) {
    for (const field of fields) {
      add("nodeIdsByFieldDefinition", field.fieldDefinitionId, nodeId);
    }
  }
  projection.templateNodeInstances.forEach((instance, index) => {
    const identity = String(index);
    add("templateNodeInstancesByOwner", instance.ownerNodeId, identity);
    add("templateNodeInstancesByTemplate", instance.templateNodeId, identity);
    add("templateNodeInstancesByOccurrence", instance.instanceOccurrenceId, identity);
    if (instance.instanceNodeId !== null) {
      add("templateNodeInstancesByNode", instance.instanceNodeId, identity);
    }
    for (const source of instance.sources) {
      add("templateNodeInstancesBySupertag", source.supertagId, identity);
      add("templateNodeInstancesBySupertag", source.appliedSupertagId, identity);
    }
  });

  return {
    sectionIdentities: Object.fromEntries(
      PROJECTION_SECTION_NAMES.map((section) => [section, projectionSectionIdentities(projection, section)]),
    ) as Record<ProjectionSectionName, readonly string[]>,
    lookups: Object.fromEntries(
      PROJECTION_LOOKUP_INDEX_NAMES.map((name) => [
        name,
        new Map([...lookups[name]].map(([identity, values]) => [identity, [...values].sort(stableStringCompare)])),
      ]),
    ) as unknown as Record<ProjectionLookupIndexName, ReadonlyMap<string, readonly string[]>>,
  };
}

function projectionSectionIdentities(projection: Projection, section: ProjectionSectionName): readonly string[] {
  return (
    section === "templateNodeInstances"
      ? projection.templateNodeInstances.map((_value, index) => String(index))
      : Object.keys(projection[section])
  ).sort(stableStringCompare);
}
