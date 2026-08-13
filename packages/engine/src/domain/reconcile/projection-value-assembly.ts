import {
  stableStringCompare,
  type JsonValue,
  type ProjectionIdentity,
  type ViewMode,
} from "../fact/index.js";
import type {
  EffectiveField,
  MaterializedField,
  NodeStatus,
  Projection,
  ProjectedNode,
  ProjectedOccurrence,
  TemplateField,
  TemplateNodeInstance,
} from "./projection-types.js";
import type { MutableNode, MutableOccurrence } from "./projection-state.js";
import { valueTargetAddress } from "./value-address.js";
import { sortedRecord } from "./sorted-record.js";
import type { ConflictIssue } from "../conflict/types.js";

export function assembleProjection(
  input: Readonly<{
    view: ViewMode;
    identity: ProjectionIdentity;
    nodes: ReadonlyMap<string, MutableNode>;
    occurrences: ReadonlyMap<string, MutableOccurrence>;
    children: ReadonlyMap<string, readonly string[]>;
    addressedValues: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
    nodeOwners: Readonly<Record<string, string | null>>;
    schemaApplications: Readonly<Record<string, readonly string[]>>;
    schemaFields: Readonly<Record<string, readonly string[]>>;
    templateFields: Readonly<Record<string, readonly TemplateField[]>>;
    schemaTemplateNodes: Readonly<Record<string, readonly string[]>>;
    templateNodeInstances: readonly TemplateNodeInstance[];
    schemaExtensions: Readonly<Record<string, readonly string[]>>;
    schemaSearchMembers: Readonly<Record<string, readonly string[]>>;
    schemaExtensionConflicts: Readonly<Record<string, readonly string[]>>;
    nodeStatuses: Readonly<Record<string, NodeStatus>>;
    conflictIssues: Readonly<Record<string, ConflictIssue>>;
    effectiveFields: Readonly<Record<string, readonly EffectiveField[]>>;
    materializedFields: Readonly<Record<string, readonly MaterializedField[]>>;
    reviewScopes: Readonly<Record<string, readonly string[]>>;
    supportByContribution: Readonly<Record<string, readonly string[]>>;
  }>,
): Projection {
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
    reviewScopes: input.reviewScopes,
    supportByContribution: input.supportByContribution,
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
      const metadata = Object.assign(
        { ...occurrence.metadata },
        addressed[valueTargetAddress(owner, "metadata")],
      );
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
