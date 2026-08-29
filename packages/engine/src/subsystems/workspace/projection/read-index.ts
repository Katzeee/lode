import { stableStringCompare, type ProjectionPerspective } from "../../../domain/fact/index.js";
import {
  PROJECTION_SECTION_NAMES,
  type Projection,
  type ProjectionGeneration,
  type ProjectionSectionName,
} from "../../../domain/reconcile/index.js";

export type ProjectionReadIndex = Readonly<{
  sectionIdentities: Readonly<Record<ProjectionSectionName, readonly string[]>>;
  nodeIdsBySupertag: ReadonlyMap<string, readonly string[]>;
}>;

export type ProjectionGenerationReadIndexes = Readonly<Record<ProjectionPerspective, ProjectionReadIndex>>;

export function createProjectionReadIndexes(generation: ProjectionGeneration): ProjectionGenerationReadIndexes {
  return {
    origin: createProjectionReadIndex(generation.origin),
    review: createProjectionReadIndex(generation.review),
  };
}

function createProjectionReadIndex(projection: Projection): ProjectionReadIndex {
  const nodeIdsBySupertag = new Map<string, Set<string>>();
  const addSupertagNode = (identity: string, value: string) => {
    const values = nodeIdsBySupertag.get(identity) ?? new Set<string>();
    values.add(value);
    nodeIdsBySupertag.set(identity, values);
  };

  for (const [nodeId, applications] of Object.entries(projection.supertagApplications)) {
    const appliedSupertagIds = applications.map((application) => application.supertagId);
    for (const [requestedSupertagId, instanceSupertagIds] of Object.entries(projection.supertagInstanceSupertags)) {
      if (appliedSupertagIds.some((supertagId) => instanceSupertagIds.includes(supertagId))) {
        addSupertagNode(requestedSupertagId, nodeId);
      }
    }
    for (const supertagId of appliedSupertagIds.filter(
      (supertagId) => projection.supertagInstanceSupertags[supertagId] === undefined,
    )) {
      addSupertagNode(supertagId, nodeId);
    }
  }

  return {
    sectionIdentities: Object.fromEntries(
      PROJECTION_SECTION_NAMES.map((section) => [section, projectionSectionIdentities(projection, section)]),
    ) as Record<ProjectionSectionName, readonly string[]>,
    nodeIdsBySupertag: new Map(
      [...nodeIdsBySupertag].map(([identity, values]) => [identity, [...values].sort(stableStringCompare)]),
    ),
  };
}

function projectionSectionIdentities(projection: Projection, section: ProjectionSectionName): readonly string[] {
  return (
    section === "templateNodeInstances"
      ? projection.templateNodeInstances.map((_value, index) => String(index))
      : Object.keys(projection[section])
  ).sort(stableStringCompare);
}
