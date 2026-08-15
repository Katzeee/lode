import { stableStringCompare, type JsonValue, type ProjectionIdentity, type ViewMode } from "../fact/index.js";
import type { Projection, ProjectionSections, ProjectedNode, ProjectedOccurrence } from "./projection-types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import type { SchemaRelations } from "./schema-relations.js";
import type { TemplateStructureProjection } from "./template-node-projection.js";
import { validateStoredTree } from "./occurrence-tree.js";
import { valueTargetAddress } from "./value-address.js";

type ProjectionAssemblyInput = Readonly<{
  view: ViewMode;
  identity: ProjectionIdentity;
  nodes: ReadonlyMap<string, MutableNode>;
  occurrences: ReadonlyMap<string, MutableOccurrence>;
  children: ReadonlyMap<string, readonly string[]>;
}> &
  Omit<ProjectionSections, "nodes" | "occurrences" | "children">;

type ProjectionArtifactAssemblyInput = Readonly<{
  view: ViewMode;
  identity: ProjectionIdentity;
  storedNodes: ReadonlyMap<string, MutableNode>;
  contentNodes: ReadonlyMap<string, MutableNode>;
  templateStructure: TemplateStructureProjection;
  nodeOwners: ProjectionSections["nodeOwners"];
  addressedValues: ProjectionSections["addressedValues"];
  schemaRelations: SchemaRelations;
  nodeStatuses: ProjectionSections["nodeStatuses"];
  conflictIssues: ProjectionSections["conflictIssues"];
}>;

export function assembleProjectionArtifacts(input: ProjectionArtifactAssemblyInput): Projection {
  validateStoredTree(input.storedNodes, input.templateStructure.occurrences);
  return assembleProjection({
    view: input.view,
    identity: input.identity,
    nodes: input.contentNodes,
    occurrences: input.templateStructure.occurrences,
    children: input.templateStructure.children,
    nodeOwners: input.nodeOwners,
    addressedValues: input.addressedValues,
    ...input.schemaRelations,
    templateNodeInstances: input.templateStructure.instances,
    nodeStatuses: input.nodeStatuses,
    conflictIssues: input.conflictIssues,
  });
}

export function assembleProjection(input: ProjectionAssemblyInput): Projection {
  const values = applyProjectedValues(input.nodes, input.occurrences, input.addressedValues);
  return {
    view: input.view,
    identity: input.identity,
    nodes: sortedRecord(values.nodes),
    occurrences: sortedRecord(values.occurrences),
    children: Object.fromEntries(
      [...input.children]
        .filter(([, ids]) => ids.length > 0)
        .sort(([left], [right]) => stableStringCompare(left, right)),
    ),
    nodeOwners: input.nodeOwners,
    addressedValues: input.addressedValues,
    schemaApplications: input.schemaApplications,
    schemaFields: input.schemaFields,
    templateFields: input.templateFields,
    schemaTemplateNodes: input.schemaTemplateNodes,
    templateNodeInstances: input.templateNodeInstances,
    schemaExtensions: input.schemaExtensions,
    schemaSearchMembers: input.schemaSearchMembers,
    schemaExtensionConflicts: input.schemaExtensionConflicts,
    nodeStatuses: input.nodeStatuses,
    conflictIssues: input.conflictIssues,
    effectiveFields: input.effectiveFields,
    materializedFields: input.materializedFields,
  };
}

export function applyProjectedValues(
  nodes: ReadonlyMap<string, MutableNode>,
  occurrences: ReadonlyMap<string, MutableOccurrence>,
  addressed: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>,
): Readonly<{
  nodes: ReadonlyMap<string, MutableNode>;
  occurrences: ReadonlyMap<string, MutableOccurrence>;
}> {
  const projectedNodes = new Map(
    [...nodes].map(([id, node]) => {
      const properties = Object.assign(
        { ...node.properties },
        addressed[valueTargetAddress({ kind: "node", id: node.nodeId }, "property")],
        addressed[valueTargetAddress({ kind: "node", id: node.nodeId }, "schema")],
      );
      const metadata = Object.assign(
        { ...node.metadata },
        addressed[valueTargetAddress({ kind: "node", id: node.nodeId }, "metadata")],
      );
      return [id, { ...node, properties, metadata }] as const;
    }),
  );
  const projectedOccurrences = new Map(
    [...occurrences].map(([id, occurrence]) => {
      const owner = { kind: "occurrence" as const, id: occurrence.occurrenceId };
      const properties = Object.assign(
        { ...occurrence.properties },
        addressed[valueTargetAddress(owner, "property")],
        addressed[valueTargetAddress(owner, "schema")],
      );
      const metadata = Object.assign({ ...occurrence.metadata }, addressed[valueTargetAddress(owner, "metadata")]);
      return [id, { ...occurrence, properties, metadata }] as const;
    }),
  );
  return { nodes: projectedNodes, occurrences: projectedOccurrences };
}

export function stripProjectedValues(
  nodes: Readonly<Record<string, ProjectedNode>>,
  occurrences: Readonly<Record<string, ProjectedOccurrence>>,
  addressed: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>,
): Readonly<{
  nodes: Map<string, MutableNode>;
  occurrences: Map<string, MutableOccurrence>;
}> {
  const strippedNodes = new Map(
    Object.entries(nodes).map(([id, node]): [string, MutableNode] => {
      const properties = { ...node.properties };
      const metadata = { ...node.metadata };
      deleteAddressedKeys(properties, addressed, { kind: "node", id }, "property");
      deleteAddressedKeys(properties, addressed, { kind: "node", id }, "schema");
      deleteAddressedKeys(metadata, addressed, { kind: "node", id }, "metadata");
      return [id, { ...node, text: [...node.text], properties, metadata }];
    }),
  );
  const strippedOccurrences = new Map(
    Object.entries(occurrences).map(([id, occurrence]): [string, MutableOccurrence] => {
      const properties = { ...occurrence.properties };
      const metadata = { ...occurrence.metadata };
      deleteAddressedKeys(properties, addressed, { kind: "occurrence", id }, "property");
      deleteAddressedKeys(properties, addressed, { kind: "occurrence", id }, "schema");
      deleteAddressedKeys(metadata, addressed, { kind: "occurrence", id }, "metadata");
      return [id, { ...occurrence, properties, metadata }];
    }),
  );
  return { nodes: strippedNodes, occurrences: strippedOccurrences };
}

function deleteAddressedKeys(
  target: Record<string, JsonValue>,
  addressed: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>,
  owner: Readonly<{ kind: "node" | "occurrence"; id: string }>,
  namespace: "property" | "metadata" | "schema",
): void {
  for (const key of Object.keys(addressed[valueTargetAddress(owner, namespace)] ?? {})) {
    delete target[key];
  }
}

function sortedRecord<T>(values: ReadonlyMap<string, T>): Readonly<Record<string, T>> {
  return Object.fromEntries([...values].sort(([left], [right]) => stableStringCompare(left, right)));
}
