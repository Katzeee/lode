import { stableStringCompare } from "../../domain/fact/index.js";
import type { Projection } from "../../domain/reconcile/index.js";
import { isStringArray } from "../../shape-validation/index.js";

export type ProjectionIndexEntry = Readonly<{
  section:
    | "occurrenceIdsByNode"
    | "nodeIdsByOwner"
    | "nodeIdsBySchema"
    | "nodeIdsByFieldDefinition"
    | "schemaInstanceMemberships"
    | "templateNodeInstancesByOwner"
    | "templateNodeInstancesByTemplate"
    | "templateNodeInstancesByNode"
    | "templateNodeInstancesByOccurrence"
    | "templateNodeInstancesBySchema";
  identity: string;
  value: readonly string[] | string;
}>;

export function isProjectionIndexSection(section: string): section is ProjectionIndexEntry["section"] {
  return (
    section === "occurrenceIdsByNode" ||
    section === "nodeIdsByOwner" ||
    section === "nodeIdsBySchema" ||
    section === "nodeIdsByFieldDefinition" ||
    section === "schemaInstanceMemberships" ||
    section.startsWith("templateNodeInstancesBy")
  );
}

export function isProjectionIndexValue(section: ProjectionIndexEntry["section"], value: unknown): boolean {
  return section === "schemaInstanceMemberships" ? typeof value === "string" : isStringArray(value);
}

export function projectionIndexEntries(projection: Projection): readonly ProjectionIndexEntry[] {
  const indexes = new Map<
    string,
    {
      section: ProjectionIndexEntry["section"];
      identity: string;
      values: string[];
    }
  >();
  const add = (section: ProjectionIndexEntry["section"], identity: string, value: string) => {
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
  for (const [nodeId, schemaIds] of Object.entries(projection.schemaApplications)) {
    for (const [searchSchemaId, memberSchemaIds] of Object.entries(projection.schemaSearchMembers)) {
      if (schemaIds.some((schemaId) => memberSchemaIds.includes(schemaId))) {
        add("nodeIdsBySchema", searchSchemaId, nodeId);
        addMembership(indexes, searchSchemaId, nodeId);
      }
    }
    for (const schemaId of schemaIds.filter((schemaId) => projection.schemaSearchMembers[schemaId] === undefined)) {
      add("nodeIdsBySchema", schemaId, nodeId);
      addMembership(indexes, schemaId, nodeId);
    }
  }
  for (const [nodeId, fields] of Object.entries(projection.effectiveFields)) {
    for (const field of fields) {
      add("nodeIdsByFieldDefinition", field.fieldDefinitionId, nodeId);
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
      add("templateNodeInstancesBySchema", source.schemaId, identity);
      add("templateNodeInstancesBySchema", source.appliedSchemaId, identity);
    }
  });
  return [...indexes.values()].map((index) => ({
    section: index.section,
    identity: index.identity,
    value:
      index.section === "schemaInstanceMemberships" ? (index.values[0] ?? "") : index.values.sort(stableStringCompare),
  }));
}

function addMembership(
  indexes: Map<string, { section: ProjectionIndexEntry["section"]; identity: string; values: string[] }>,
  schemaId: string,
  nodeId: string,
): void {
  const identity = `${encodeURIComponent(schemaId)}/${encodeURIComponent(nodeId)}`;
  indexes.set(JSON.stringify(["schemaInstanceMemberships", identity]), {
    section: "schemaInstanceMemberships",
    identity,
    values: [nodeId],
  });
}
