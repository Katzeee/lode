import {
  detachedSupertagValueNodeId,
  detachedSupertagValueOccurrenceId,
  detachedViewValueNodeId,
  detachedViewValueOccurrenceId,
  fieldDefinitionEndpointOccurrenceId,
  type FactTransaction,
  type Mutation,
} from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";
import { addFieldValueReorderRoles } from "./field-value-role-ownership.js";

export type OwnedRoles = Readonly<{
  nodes: Set<string>;
  owners: Set<string>;
  references: Set<string>;
  occurrences: Set<string>;
  parents: Set<string>;
  inlineReferences: Set<string>;
}>;

type RoleWriter = Readonly<{
  node: (...nodeIds: readonly string[]) => void;
  owner: (...nodeIds: readonly string[]) => void;
  occurrence: (...occurrenceIds: readonly string[]) => void;
  parent: (...nodeIds: readonly string[]) => void;
  metanode: (hostNodeId: string) => void;
}>;

export function collectOwnedRoles(transaction: FactTransaction, projections: readonly Projection[]): OwnedRoles {
  const roles: OwnedRoles = {
    nodes: new Set<string>(),
    owners: new Set<string>(),
    references: new Set<string>(),
    occurrences: new Set<string>(),
    parents: new Set<string>(),
    inlineReferences: new Set<string>(),
  };
  const writer = createRoleWriter(roles, projections);
  for (const fact of transaction.facts) {
    if (fact.body.kind === "contribution") {
      addSemanticOwnedRoles(fact.body.mutation, writer);
    }
  }
  addParentChildren(roles, projections);
  addFieldValueReorderRoles(transaction, projections, roles);
  addReferencedNodes(roles, projections);
  addTypedFieldValueNodes(transaction, projections, roles);
  return roles;
}

function addTypedFieldValueNodes(
  transaction: FactTransaction,
  projections: readonly Projection[],
  roles: OwnedRoles,
): void {
  for (const fact of transaction.facts) {
    if (fact.body.kind !== "contribution" || fact.body.mutation.kind !== "field-materialize") {
      continue;
    }
    const mutation = fact.body.mutation;
    for (const projection of projections) {
      const field = projection.typedFieldValues[mutation.ownerNodeId]?.find(
        (candidate) =>
          candidate.fieldDefinitionId === mutation.fieldDefinitionId &&
          candidate.fieldNodeId === mutation.fieldNodeId &&
          candidate.state === "value",
      );
      if (field?.state === "value") {
        if (field.value.kind === "number" || field.value.kind === "date") {
          roles.nodes.add(field.value.valueNodeId);
        } else {
          roles.references.add(field.value.valueNodeId);
        }
      }
    }
  }
}

function createRoleWriter(roles: OwnedRoles, projections: readonly Projection[]): RoleWriter {
  const node = (...nodeIds: readonly string[]): void => nodeIds.forEach((nodeId) => roles.nodes.add(nodeId));
  const owner = (...nodeIds: readonly string[]): void => nodeIds.forEach((nodeId) => roles.owners.add(nodeId));
  const occurrence = (...occurrenceIds: readonly string[]): void =>
    occurrenceIds.forEach((occurrenceId) => roles.occurrences.add(occurrenceId));
  const parent = (...nodeIds: readonly string[]): void => nodeIds.forEach((nodeId) => roles.parents.add(nodeId));
  const metanode = (hostNodeId: string): void => {
    for (const projection of projections) {
      const metanodeId = projection.metanodes[hostNodeId];
      if (metanodeId !== undefined) {
        node(metanodeId);
        parent(metanodeId);
      }
    }
  };
  return { node, owner, occurrence, parent, metanode };
}

function addSemanticOwnedRoles(mutation: Mutation, write: RoleWriter): void {
  if (addSupertagOwnedRoles(mutation, write)) {
    return;
  }
  if (addFieldOwnedRoles(mutation, write)) {
    return;
  }
  addHostConfigurationOwnedRoles(mutation, write);
}

function addSupertagOwnedRoles(mutation: Mutation, write: RoleWriter): boolean {
  if (mutation.kind === "supertag-apply") {
    write.node(mutation.applicationNodeId, detachedSupertagValueNodeId(mutation.applicationNodeId));
    write.occurrence(
      mutation.applicationOccurrenceId,
      mutation.relationDefinitionOccurrenceId,
      mutation.definitionOccurrenceId,
      detachedSupertagValueOccurrenceId(mutation.applicationNodeId),
    );
    write.parent(mutation.applicationNodeId);
    write.metanode(mutation.hostNodeId);
    return true;
  }
  if (mutation.kind === "supertag-remove") {
    write.node(mutation.applicationNodeId, mutation.detachedValueNodeId);
    write.occurrence(
      mutation.applicationOccurrenceId,
      mutation.relationDefinitionOccurrenceId,
      mutation.definitionOccurrenceId,
      mutation.detachedValueOccurrenceId,
    );
    write.parent(mutation.applicationNodeId);
    write.metanode(mutation.hostNodeId);
    return true;
  }
  if (mutation.kind === "supertag-template-node-add" || mutation.kind === "supertag-template-node-remove") {
    write.occurrence(mutation.templateOccurrenceId);
    return true;
  }
  if (mutation.kind === "supertag-template-field-attach" || mutation.kind === "supertag-template-field-detach") {
    write.node(mutation.templateFieldNodeId);
    write.owner(mutation.templateFieldNodeId, mutation.fieldDefinitionId, mutation.staticDefaultValueNodeId);
    write.occurrence(
      mutation.templateFieldOccurrenceId,
      mutation.definitionOccurrenceId,
      mutation.staticDefaultValueOccurrenceId,
    );
    write.parent(mutation.templateFieldNodeId, mutation.supertagId);
    return true;
  }
  if (mutation.kind === "supertag-template-field-existing-attach") {
    write.node(mutation.templateFieldNodeId);
    write.owner(mutation.templateFieldNodeId, mutation.staticDefaultValueNodeId);
    write.occurrence(
      mutation.templateFieldOccurrenceId,
      mutation.definitionOccurrenceId,
      mutation.staticDefaultValueOccurrenceId,
    );
    write.parent(mutation.templateFieldNodeId, mutation.supertagId);
    return true;
  }
  if (mutation.kind === "supertag-template-field-discoverability-set") {
    write.owner(mutation.fieldDefinitionId);
    return true;
  }
  if (mutation.kind === "supertag-template-field-visibility-configure") {
    return true;
  }
  if (
    mutation.kind === "supertag-optional-field-contribution-attach" ||
    mutation.kind === "supertag-optional-field-contribution-detach"
  ) {
    write.node(mutation.fieldNurseryNodeId, mutation.contributionNodeId);
    write.owner(
      mutation.fieldNurseryNodeId,
      mutation.nurseryValueNodeId,
      mutation.contributionNodeId,
      mutation.valueNodeId,
    );
    write.occurrence(
      mutation.fieldNurseryOccurrenceId,
      mutation.nurseryDefinitionOccurrenceId,
      mutation.nurseryValueOccurrenceId,
      mutation.contributionOccurrenceId,
      mutation.definitionOccurrenceId,
      mutation.valueOccurrenceId,
    );
    write.parent(mutation.fieldNurseryNodeId, mutation.nurseryValueNodeId, mutation.contributionNodeId);
    write.metanode(mutation.supertagId);
    return true;
  }
  if (mutation.kind === "template-node-detach") {
    write.node(mutation.instanceNodeId);
    write.occurrence(mutation.instanceOccurrenceId);
    return true;
  }
  return false;
}

function addFieldOwnedRoles(mutation: Mutation, write: RoleWriter): boolean {
  if (mutation.kind === "field-materialize" || mutation.kind === "materialized-field-delete") {
    write.node(mutation.fieldNodeId);
    write.occurrence(mutation.fieldOccurrenceId, fieldDefinitionEndpointOccurrenceId(mutation.fieldOccurrenceId));
    return true;
  }
  if (mutation.kind === "field-value-delete") {
    write.occurrence(mutation.valueOccurrenceId);
    return true;
  }
  if (
    mutation.kind === "field-datatype-configure" ||
    mutation.kind === "field-cardinality-configure" ||
    mutation.kind === "field-optionality-configure"
  ) {
    write.node(mutation.configurationNodeId);
    write.occurrence(mutation.configurationOccurrenceId);
    write.parent(mutation.configurationNodeId);
    return true;
  }
  if (mutation.kind === "field-initialization-expression-configure") {
    write.node(mutation.configurationNodeId, mutation.expression.expressionNodeId, mutation.expression.contextNodeId);
    write.occurrence(
      mutation.configurationOccurrenceId,
      mutation.expression.expressionOccurrenceId,
      mutation.expression.sourceFieldDefinitionOccurrenceId,
      mutation.expression.contextOccurrenceId,
    );
    write.parent(mutation.configurationNodeId, mutation.expression.expressionNodeId);
    return true;
  }
  return false;
}

function addHostConfigurationOwnedRoles(mutation: Mutation, write: RoleWriter): void {
  if (mutation.kind === "search-expression-attach" || mutation.kind === "search-expression-detach") {
    write.node(mutation.expressionNodeId);
    write.occurrence(mutation.expressionOccurrenceId, mutation.definitionOccurrenceId);
    write.parent(mutation.expressionNodeId);
    write.metanode(mutation.searchNodeId);
  } else if (mutation.kind === "shared-default-view-definition-attach") {
    write.node(
      mutation.attachmentNodeId,
      mutation.viewDefinitionNodeId,
      detachedViewValueNodeId(mutation.attachmentNodeId),
    );
    write.occurrence(
      mutation.attachmentOccurrenceId,
      mutation.relationDefinitionOccurrenceId,
      mutation.viewDefinitionOccurrenceId,
      detachedViewValueOccurrenceId(mutation.attachmentNodeId),
    );
    write.parent(mutation.attachmentNodeId);
    write.metanode(mutation.hostNodeId);
  } else if (mutation.kind === "shared-default-view-definition-detach") {
    write.node(mutation.attachmentNodeId, mutation.viewDefinitionNodeId, mutation.detachedValueNodeId);
    write.occurrence(
      mutation.attachmentOccurrenceId,
      mutation.relationDefinitionOccurrenceId,
      mutation.viewDefinitionOccurrenceId,
      mutation.detachedValueOccurrenceId,
    );
    write.parent(mutation.attachmentNodeId);
    write.metanode(mutation.hostNodeId);
  } else if (mutation.kind === "shared-default-view-definition-sort-by-name-set") {
    write.node(mutation.sortOrderFieldNodeId, mutation.sortFieldNodeId);
    write.occurrence(
      mutation.sortOrderFieldOccurrenceId,
      mutation.sortFieldOccurrenceId,
      fieldDefinitionEndpointOccurrenceId(mutation.sortOrderFieldOccurrenceId),
      fieldDefinitionEndpointOccurrenceId(mutation.sortFieldOccurrenceId),
      mutation.nodeNameOccurrenceId,
      mutation.ascendingOccurrenceId,
    );
    if (mutation.enabled) {
      write.parent(mutation.sortOrderFieldNodeId, mutation.sortFieldNodeId);
    }
  }
}

function addParentChildren(roles: OwnedRoles, projections: readonly Projection[]): void {
  for (const parentNodeId of roles.parents) {
    for (const projection of projections) {
      for (const occurrenceId of projection.childOccurrences[parentNodeId] ?? []) {
        roles.occurrences.add(occurrenceId);
      }
    }
  }
}

function addReferencedNodes(roles: OwnedRoles, projections: readonly Projection[]): void {
  for (const occurrenceId of roles.occurrences) {
    for (const projection of projections) {
      const nodeId = projection.occurrences[occurrenceId]?.nodeId;
      if (nodeId !== undefined) {
        roles.references.add(nodeId);
      }
    }
  }
}
