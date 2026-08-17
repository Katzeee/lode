import { deriveActivation } from "../activation/index.js";
import { SYSTEM_DEFINITION_CATALOG_NODE_ID, type FactSnapshot } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";

export type ProtectedRoles = Readonly<{
  nodes: ReadonlySet<string>;
  owners: ReadonlySet<string>;
  intrinsicNodeTypes: ReadonlySet<string>;
  occurrences: ReadonlySet<string>;
  closedParents: ReadonlySet<string>;
  inlineReferences: ReadonlySet<string>;
}>;

type MutableProtectedRoles = {
  nodes: Set<string>;
  owners: Set<string>;
  intrinsicNodeTypes: Set<string>;
  occurrences: Set<string>;
  closedParents: Set<string>;
  inlineReferences: Set<string>;
};

export function collectProtectedRoles(projections: readonly Projection[], snapshot: FactSnapshot): ProtectedRoles {
  const roles: MutableProtectedRoles = {
    nodes: new Set<string>(),
    owners: new Set<string>(),
    intrinsicNodeTypes: new Set<string>(),
    occurrences: new Set<string>(),
    closedParents: new Set<string>(),
    inlineReferences: new Set<string>(),
  };
  for (const projection of projections) {
    addSystemCatalogRoles(projection, roles);
    addMetanodeRoles(projection, roles);
    addHostRelationRoles(projection, roles);
    addFieldConfigurationRoles(projection, roles);
    addTypedFieldValueRoles(projection, roles);
    addSupertagDefinitionRoles(projection, roles);
    addRemovedRelationRoles(projection, snapshot, roles);
  }
  return roles;
}

function addTypedFieldValueRoles(projection: Projection, roles: MutableProtectedRoles): void {
  for (const fields of Object.values(projection.typedFieldValues)) {
    for (const field of fields) {
      if (field.state === "value" && (field.value.kind === "number" || field.value.kind === "date")) {
        protectNode(projection, roles, field.value.valueNodeId);
      }
    }
  }
}

function addMetanodeRoles(projection: Projection, roles: MutableProtectedRoles): void {
  for (const hostNodeId of Object.keys(projection.metanodes)) {
    protectMetanode(projection, roles, hostNodeId);
  }
}

function addRemovedRelationRoles(projection: Projection, snapshot: FactSnapshot, roles: MutableProtectedRoles): void {
  const activation = deriveActivation(snapshot.facts, projection.perspective);
  for (const fact of snapshot.facts) {
    if (fact.body.kind !== "contribution" || !activation.activeContributionIds.has(fact.id)) {
      continue;
    }
    const mutation = fact.body.mutation;
    if (mutation.kind === "supertag-remove") {
      protectTuple(projection, roles, mutation.applicationNodeId, [
        mutation.relationDefinitionOccurrenceId,
        mutation.definitionOccurrenceId,
        mutation.detachedValueOccurrenceId,
      ]);
      protectNode(projection, roles, mutation.detachedValueNodeId);
      roles.occurrences.add(mutation.applicationOccurrenceId);
      protectMetanode(projection, roles, mutation.hostNodeId);
    } else if (mutation.kind === "supertag-template-field-detach") {
      protectTuple(projection, roles, mutation.templateFieldNodeId, [
        mutation.templateFieldOccurrenceId,
        mutation.definitionOccurrenceId,
        mutation.staticDefaultValueOccurrenceId,
      ]);
      roles.owners.add(mutation.fieldDefinitionId);
      roles.owners.add(mutation.staticDefaultValueNodeId);
      roles.intrinsicNodeTypes.add(mutation.fieldDefinitionId);
    } else if (mutation.kind === "search-expression-detach") {
      protectTuple(projection, roles, mutation.expressionNodeId, [
        mutation.expressionOccurrenceId,
        mutation.definitionOccurrenceId,
      ]);
      protectMetanode(projection, roles, mutation.searchNodeId);
    } else if (mutation.kind === "shared-default-view-definition-detach") {
      protectTuple(projection, roles, mutation.attachmentNodeId, [
        mutation.attachmentOccurrenceId,
        mutation.relationDefinitionOccurrenceId,
        mutation.viewDefinitionOccurrenceId,
        mutation.detachedValueOccurrenceId,
      ]);
      protectNode(projection, roles, mutation.viewDefinitionNodeId);
      protectNode(projection, roles, mutation.detachedValueNodeId);
      protectMetanode(projection, roles, mutation.hostNodeId);
    }
  }
}

function addSystemCatalogRoles(projection: Projection, roles: MutableProtectedRoles): void {
  const systemNodeIds = systemCatalogSubtree(projection);
  for (const nodeId of systemNodeIds) {
    protectNode(projection, roles, nodeId);
    roles.intrinsicNodeTypes.add(nodeId);
    roles.closedParents.add(nodeId);
  }
  for (const occurrence of Object.values(projection.occurrences)) {
    if (systemNodeIds.has(occurrence.nodeId) || systemNodeIds.has(occurrence.parentNodeId)) {
      roles.occurrences.add(occurrence.occurrenceId);
    }
  }
}

function addHostRelationRoles(projection: Projection, roles: MutableProtectedRoles): void {
  const viewConfigurationFieldNodeIds = new Set(
    Object.values(projection.sharedDefaultViewDefinitions)
      .flat()
      .flatMap((definition) =>
        definition.sortByNameAscending === null
          ? []
          : [definition.sortByNameAscending.sortOrderFieldNodeId, definition.sortByNameAscending.sortFieldNodeId],
      ),
  );
  for (const applications of Object.values(projection.supertagApplications)) {
    for (const application of applications) {
      protectTuple(projection, roles, application.applicationNodeId, [
        application.relationDefinitionOccurrenceId,
        application.definitionOccurrenceId,
      ]);
      roles.occurrences.add(application.applicationOccurrenceId);
      roles.intrinsicNodeTypes.add(application.supertagId);
      protectMetanode(projection, roles, application.hostNodeId);
    }
  }
  for (const [hostNodeId, expression] of Object.entries(projection.searchExpressions)) {
    protectTuple(projection, roles, expression.expressionNodeId, [expression.definitionOccurrenceId]);
    roles.occurrences.add(expression.expressionOccurrenceId);
    roles.intrinsicNodeTypes.add(hostNodeId);
    protectMetanode(projection, roles, hostNodeId);
  }
  for (const definitions of Object.values(projection.sharedDefaultViewDefinitions)) {
    for (const definition of definitions) {
      protectTuple(projection, roles, definition.attachmentNodeId, [
        definition.relationDefinitionOccurrenceId,
        definition.viewDefinitionOccurrenceId,
      ]);
      protectNode(projection, roles, definition.viewDefinitionNodeId);
      roles.occurrences.add(definition.attachmentOccurrenceId);
      protectMetanode(projection, roles, definition.hostNodeId);
      for (const fieldDefinitionId of [
        ...definition.options.columns.map((column) => column.fieldDefinitionId),
        ...(definition.options.sort === null ? [] : [definition.options.sort.fieldDefinitionId]),
        ...(definition.options.group === null ? [] : [definition.options.group.fieldDefinitionId]),
      ]) {
        roles.owners.add(fieldDefinitionId);
        roles.intrinsicNodeTypes.add(fieldDefinitionId);
      }
      const sort = definition.sortByNameAscending;
      if (sort !== null) {
        protectTuple(projection, roles, sort.sortOrderFieldNodeId, [
          ...(projection.childOccurrences[sort.sortOrderFieldNodeId] ?? []),
          sort.sortOrderFieldOccurrenceId,
        ]);
        protectTuple(projection, roles, sort.sortFieldNodeId, [
          ...(projection.childOccurrences[sort.sortFieldNodeId] ?? []),
          sort.sortFieldOccurrenceId,
          sort.nodeNameOccurrenceId,
          sort.ascendingOccurrenceId,
        ]);
      }
    }
  }
  for (const fields of Object.values(projection.materializedFields)) {
    for (const field of fields) {
      protectNode(projection, roles, field.fieldNodeId);
      roles.occurrences.add(field.fieldOccurrenceId);
      roles.occurrences.add(field.definitionOccurrenceId);
      if (!viewConfigurationFieldNodeIds.has(field.fieldNodeId)) {
        field.valueOccurrenceIds.forEach((occurrenceId) => roles.occurrences.add(occurrenceId));
      }
      roles.intrinsicNodeTypes.add(field.fieldDefinitionId);
    }
  }
  for (const fields of Object.values(projection.templateFields)) {
    for (const field of fields) {
      protectTuple(projection, roles, field.templateFieldNodeId, [
        field.templateFieldOccurrenceId,
        field.definitionOccurrenceId,
        field.staticDefaultValueOccurrenceId,
      ]);
      roles.owners.add(field.fieldDefinitionId);
      roles.owners.add(field.staticDefaultValueNodeId);
      roles.intrinsicNodeTypes.add(field.fieldDefinitionId);
    }
  }
  for (const contributions of Object.values(projection.optionalFieldContributions)) {
    for (const contribution of contributions) {
      protectTuple(projection, roles, contribution.fieldNurseryNodeId, [contribution.fieldNurseryOccurrenceId]);
      roles.closedParents.add(contribution.nurseryValueNodeId);
      protectTuple(projection, roles, contribution.contributionNodeId, [
        contribution.contributionOccurrenceId,
        contribution.definitionOccurrenceId,
        contribution.valueOccurrenceId,
      ]);
      roles.owners.add(contribution.valueNodeId);
      roles.intrinsicNodeTypes.add(contribution.fieldDefinitionId);
      protectMetanode(projection, roles, contribution.supertagId);
    }
  }
}

function addFieldConfigurationRoles(projection: Projection, roles: MutableProtectedRoles): void {
  for (const [fieldDefinitionId, configurations] of Object.entries(projection.fieldDefinitionConfigurations)) {
    roles.intrinsicNodeTypes.add(fieldDefinitionId);
    for (const configuration of configurations) {
      protectTuple(
        projection,
        roles,
        configuration.configurationNodeId,
        projection.childOccurrences[configuration.configurationNodeId] ?? [],
      );
      roles.occurrences.add(configuration.configurationOccurrenceId);
      if (configuration.kind === "initialization-expression") {
        const expression = configuration.expression;
        protectTuple(projection, roles, expression.expressionNodeId, [
          expression.sourceFieldDefinitionOccurrenceId,
          expression.contextOccurrenceId,
        ]);
        roles.occurrences.add(expression.expressionOccurrenceId);
        roles.intrinsicNodeTypes.add(expression.sourceFieldDefinitionId);
      }
    }
  }
}

function addSupertagDefinitionRoles(projection: Projection, roles: MutableProtectedRoles): void {
  for (const [supertagId, templateNodeIds] of Object.entries(projection.supertagTemplateNodes)) {
    for (const occurrenceId of projection.childOccurrences[supertagId] ?? []) {
      const occurrence = projection.occurrences[occurrenceId];
      if (occurrence !== undefined && templateNodeIds.includes(occurrence.nodeId)) {
        roles.occurrences.add(occurrenceId);
      }
    }
    roles.intrinsicNodeTypes.add(supertagId);
  }
  for (const [supertagId, baseSupertagIds] of Object.entries(projection.supertagExtensions)) {
    roles.intrinsicNodeTypes.add(supertagId);
    baseSupertagIds.forEach((nodeId) => roles.intrinsicNodeTypes.add(nodeId));
  }
}

function protectNode(projection: Projection, roles: MutableProtectedRoles, nodeId: string): void {
  roles.nodes.add(nodeId);
  roles.owners.add(nodeId);
  for (const item of projection.nodes[nodeId]?.content ?? []) {
    if (item.kind === "inline-reference") {
      roles.inlineReferences.add(item.id);
    }
  }
}

function protectTuple(
  projection: Projection,
  roles: MutableProtectedRoles,
  nodeId: string,
  occurrenceIds: readonly string[],
): void {
  protectNode(projection, roles, nodeId);
  roles.closedParents.add(nodeId);
  occurrenceIds.forEach((occurrenceId) => roles.occurrences.add(occurrenceId));
}

function protectMetanode(projection: Projection, roles: MutableProtectedRoles, hostNodeId: string): void {
  const metanodeId = projection.metanodes[hostNodeId];
  if (metanodeId !== undefined) {
    protectNode(projection, roles, metanodeId);
    roles.closedParents.add(metanodeId);
  }
}

function systemCatalogSubtree(projection: Projection): Set<string> {
  const result = new Set<string>();
  if (
    projection.nodes[SYSTEM_DEFINITION_CATALOG_NODE_ID] === undefined &&
    projection.nodeOwners[SYSTEM_DEFINITION_CATALOG_NODE_ID] === undefined
  ) {
    return result;
  }
  result.add(SYSTEM_DEFINITION_CATALOG_NODE_ID);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [nodeId, ownerNodeId] of Object.entries(projection.nodeOwners)) {
      if (ownerNodeId !== null && result.has(ownerNodeId) && !result.has(nodeId)) {
        result.add(nodeId);
        changed = true;
      }
    }
  }
  return result;
}
