import { stableStringCompare, type ContributionFact } from "../fact/index.js";
import type { NodeStatus } from "./projection-types.js";

export function projectNodeStatuses(
  active: readonly ContributionFact[],
  knownNodeIds: ReadonlySet<string>,
  activeNodeIds: ReadonlySet<string>,
  deletionFactIds: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, NodeStatus>> {
  const roles = definitionRoles(active);
  const nodeIds = new Set([
    ...knownNodeIds,
    ...activeNodeIds,
    ...deletionFactIds.keys(),
    ...roles.keys(),
  ]);
  return Object.fromEntries(
    [...nodeIds].sort(stableStringCompare).flatMap((nodeId) => {
      const state = activeNodeIds.has(nodeId)
        ? "active"
        : (deletionFactIds.get(nodeId)?.length ?? 0) > 0
          ? "deleted"
          : null;
      return state === null
        ? []
        : [
            [
              nodeId,
              {
                nodeId,
                roles: [...(roles.get(nodeId) ?? [])].sort(stableStringCompare),
                state,
                deletionFactIds: [...(deletionFactIds.get(nodeId) ?? [])].sort(stableStringCompare),
              },
            ] as const,
          ];
    }),
  );
}

function definitionRoles(
  active: readonly ContributionFact[],
): ReadonlyMap<string, ReadonlySet<"schema" | "field">> {
  const roles = new Map<string, Set<"schema" | "field">>();
  const add = (nodeId: string, role: "schema" | "field") => {
    const nodeRoles = roles.get(nodeId) ?? new Set();
    nodeRoles.add(role);
    roles.set(nodeId, nodeRoles);
  };
  for (const fact of active) {
    const mutation = fact.body.mutation;
    switch (mutation.kind) {
      case "schema-apply":
      case "schema-remove":
        add(mutation.schemaId, "schema");
        break;
      case "schema-field-add":
      case "schema-field-remove":
      case "schema-field-configure":
        add(mutation.schemaId, "schema");
        add(mutation.fieldDefinitionId, "field");
        break;
      case "schema-extension-add":
      case "schema-extension-remove":
        add(mutation.schemaId, "schema");
        add(mutation.baseSchemaId, "schema");
        break;
      case "schema-template-node-add":
      case "schema-template-node-remove":
        add(mutation.schemaId, "schema");
        break;
      case "field-materialize":
      case "field-value-delete":
      case "materialized-field-delete":
        add(mutation.fieldDefinitionId, "field");
        break;
      case "field-initialize":
        add(mutation.schemaId, "schema");
        add(mutation.fieldDefinitionId, "field");
        break;
      case "node-create":
      case "node-delete":
      case "node-restore":
      case "occurrence-create":
      case "occurrence-delete":
      case "occurrence-restore":
      case "occurrence-move":
      case "node-owner-set":
      case "text-splice":
      case "text-mark":
      case "value-set":
      case "value-unset":
      case "template-node-detach":
        break;
    }
  }
  return roles;
}
