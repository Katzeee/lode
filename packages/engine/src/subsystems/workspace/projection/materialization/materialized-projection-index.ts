import { stableStringCompare } from "../../../../domain/fact/index.js";
import type { Projection } from "../../../../domain/reconcile/index.js";
import { isStringArray } from "../../../../decoding/index.js";

export type ProjectionLookupIndexEntry = Readonly<{
  section:
    | "occurrenceIdsByNode"
    | "nodeIdsByOwner"
    | "nodeIdsBySupertag"
    | "nodeIdsByFieldDefinition"
    | "supertagInstanceMemberships"
    | "templateNodeInstancesByOwner"
    | "templateNodeInstancesByTemplate"
    | "templateNodeInstancesByNode"
    | "templateNodeInstancesByOccurrence"
    | "templateNodeInstancesBySupertag";
  identity: string;
  value: readonly string[] | string;
}>;

export function isProjectionLookupIndexSection(section: string): section is ProjectionLookupIndexEntry["section"] {
  return (
    section === "occurrenceIdsByNode" ||
    section === "nodeIdsByOwner" ||
    section === "nodeIdsBySupertag" ||
    section === "nodeIdsByFieldDefinition" ||
    section === "supertagInstanceMemberships" ||
    section.startsWith("templateNodeInstancesBy")
  );
}

export function isProjectionLookupIndexValue(section: ProjectionLookupIndexEntry["section"], value: unknown): boolean {
  return section === "supertagInstanceMemberships" ? typeof value === "string" : isStringArray(value);
}

export function projectionLookupIndexEntries(projection: Projection): readonly ProjectionLookupIndexEntry[] {
  const indexes = new Map<
    string,
    {
      section: ProjectionLookupIndexEntry["section"];
      identity: string;
      values: string[];
    }
  >();
  const add = (section: ProjectionLookupIndexEntry["section"], identity: string, value: string) => {
    const key = JSON.stringify([section, identity]);
    const index = indexes.get(key) ?? { section, identity, values: [] };
    index.values.push(value);
    indexes.set(key, index);
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
    const supertagIds = applications.map((application) => application.supertagId);
    for (const [requestedSupertagId, instanceSupertagIds] of Object.entries(projection.supertagInstanceSupertags)) {
      if (supertagIds.some((supertagId) => instanceSupertagIds.includes(supertagId))) {
        add("nodeIdsBySupertag", requestedSupertagId, nodeId);
        addMembership(indexes, requestedSupertagId, nodeId);
      }
    }
    for (const supertagId of supertagIds.filter(
      (supertagId) => projection.supertagInstanceSupertags[supertagId] === undefined,
    )) {
      add("nodeIdsBySupertag", supertagId, nodeId);
      addMembership(indexes, supertagId, nodeId);
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
  return [...indexes.values()].map((index) => ({
    section: index.section,
    identity: index.identity,
    value:
      index.section === "supertagInstanceMemberships"
        ? (index.values[0] ?? "")
        : index.values.sort(stableStringCompare),
  }));
}

function addMembership(
  indexes: Map<string, { section: ProjectionLookupIndexEntry["section"]; identity: string; values: string[] }>,
  supertagId: string,
  nodeId: string,
): void {
  const identity = `${encodeURIComponent(supertagId)}/${encodeURIComponent(nodeId)}`;
  indexes.set(JSON.stringify(["supertagInstanceMemberships", identity]), {
    section: "supertagInstanceMemberships",
    identity,
    values: [nodeId],
  });
}
