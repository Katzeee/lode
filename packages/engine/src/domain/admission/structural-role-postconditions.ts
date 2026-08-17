import {
  canonicalJson,
  FIELD_DATATYPE_NODE_IDS,
  fieldDefinitionEndpointOccurrenceId,
  NODE_VIEWS_DEFINITION_NODE_ID,
  type FactTransaction,
  type Mutation,
} from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";
import { validateTemplateFieldPostcondition } from "./template-field-role-postconditions.js";
import { validateFieldValueOccurrenceMutation } from "./field-value-role-postconditions.js";

export function validateCreatedSemanticRelations(
  transaction: FactTransaction,
  previousOrigin: Projection,
  previousReview: Projection,
  origin: Projection,
  review: Projection,
): void {
  for (const fact of transaction.facts) {
    if (fact.body.kind !== "contribution") {
      continue;
    }
    const mutation = fact.body.mutation;
    const previousProjection = fact.body.intent === "direct" ? previousOrigin : previousReview;
    const projection = fact.body.intent === "direct" ? origin : review;
    if (mutation.kind === "metanode-attach" && !hasMetanodeStructure(projection, mutation)) {
      throw new Error(`Metanode structure is invalid: ${mutation.metanodeId}`);
    }
    if (
      mutation.kind === "shared-default-view-definition-sort-by-name-set" &&
      (!matchesViewSortState(previousProjection, mutation, mutation.previousEnabled) ||
        !matchesViewSortState(projection, mutation, mutation.enabled))
    ) {
      throw new Error(`View Sort structure is invalid: ${mutation.viewDefinitionNodeId}`);
    }
    if (mutation.kind === "shared-default-view-definition-options-set") {
      const definition = projection.sharedDefaultViewDefinitions[mutation.hostNodeId]?.find(
        (candidate) => candidate.viewDefinitionNodeId === mutation.viewDefinitionNodeId,
      );
      if (
        definition === undefined ||
        !definition.optionsContributionIds.includes(fact.id) ||
        (!definition.optionsConflicted && canonicalJson(definition.options) !== canonicalJson(mutation.options))
      ) {
        throw new Error(`View options structure is invalid: ${mutation.viewDefinitionNodeId}`);
      }
    }
    if (
      mutation.kind === "supertag-apply" &&
      !projection.supertagApplications[mutation.hostNodeId]?.some(
        (application) =>
          application.applicationNodeId === mutation.applicationNodeId &&
          application.relationDefinitionOccurrenceId === mutation.relationDefinitionOccurrenceId &&
          application.definitionOccurrenceId === mutation.definitionOccurrenceId,
      )
    ) {
      throw new Error(`Supertag Application structure is invalid: ${mutation.applicationNodeId}`);
    }
    if (mutation.kind === "field-materialize" && !hasMaterializedFieldStructure(projection, mutation)) {
      throw new Error(`Materialized Field structure is invalid: ${mutation.fieldNodeId}`);
    }
    validateFieldValueOccurrenceMutation(transaction, mutation, previousProjection, projection);
    validateTemplateFieldPostcondition(mutation, previousProjection, projection);
    if (
      mutation.kind === "search-expression-attach" &&
      (projection.searchExpressions[mutation.searchNodeId]?.expressionNodeId !== mutation.expressionNodeId ||
        canonicalJson(projection.searchExpressions[mutation.searchNodeId]?.expression) !==
          canonicalJson(mutation.expression))
    ) {
      throw new Error(`Search Expression structure is invalid: ${mutation.expressionNodeId}`);
    }
    if (mutation.kind === "search-expression-detach" && !hasRemovedSearchExpressionStructure(projection, mutation)) {
      throw new Error(`Removed Search Expression structure is invalid: ${mutation.expressionNodeId}`);
    }
    if (
      mutation.kind === "shared-default-view-definition-attach" &&
      !projection.sharedDefaultViewDefinitions[mutation.hostNodeId]?.some(
        (definition) => definition.attachmentNodeId === mutation.attachmentNodeId,
      )
    ) {
      throw new Error(`View Definition structure is invalid: ${mutation.attachmentNodeId}`);
    }
    if (
      mutation.kind === "shared-default-view-definition-detach" &&
      !hasRemovedViewDefinitionStructure(projection, mutation)
    ) {
      throw new Error(`Removed View Definition structure is invalid: ${mutation.attachmentNodeId}`);
    }
    if (isFieldDefinitionConfiguration(mutation) && !hasFieldDefinitionConfiguration(projection, fact.id, mutation)) {
      throw new Error(`Field Definition configuration structure is invalid: ${mutation.configurationNodeId}`);
    }
  }
}

function matchesViewSortState(
  projection: Projection,
  mutation: Extract<Mutation, { kind: "shared-default-view-definition-sort-by-name-set" }>,
  enabled: boolean,
): boolean {
  const definition = projection.sharedDefaultViewDefinitions[mutation.hostNodeId]?.find(
    (candidate) => candidate.viewDefinitionNodeId === mutation.viewDefinitionNodeId,
  );
  if (definition === undefined) {
    return false;
  }
  if (!enabled) {
    return (
      definition.sortByNameAscending === null &&
      projection.occurrences[mutation.nodeNameOccurrenceId] === undefined &&
      projection.occurrences[mutation.ascendingOccurrenceId] === undefined &&
      projection.occurrences[mutation.sortOrderFieldOccurrenceId]?.parentNodeId !== mutation.viewDefinitionNodeId &&
      projection.occurrences[mutation.sortFieldOccurrenceId]?.parentNodeId !== mutation.sortOrderFieldNodeId
    );
  }
  const sort = definition.sortByNameAscending;
  return (
    sort !== null &&
    sort.sortOrderFieldNodeId === mutation.sortOrderFieldNodeId &&
    sort.sortOrderFieldOccurrenceId === mutation.sortOrderFieldOccurrenceId &&
    sort.sortFieldNodeId === mutation.sortFieldNodeId &&
    sort.sortFieldOccurrenceId === mutation.sortFieldOccurrenceId &&
    sort.nodeNameOccurrenceId === mutation.nodeNameOccurrenceId &&
    sort.ascendingOccurrenceId === mutation.ascendingOccurrenceId
  );
}

function hasMetanodeStructure(
  projection: Projection,
  mutation: Extract<Mutation, { kind: "metanode-attach" }>,
): boolean {
  return (
    projection.metanodes[mutation.hostNodeId] === mutation.metanodeId &&
    projection.nodeOwners[mutation.metanodeId] === mutation.hostNodeId &&
    !(projection.childOccurrences[mutation.hostNodeId] ?? []).some(
      (occurrenceId) => projection.occurrences[occurrenceId]?.nodeId === mutation.metanodeId,
    )
  );
}

function isFieldDefinitionConfiguration(mutation: Mutation): mutation is Extract<
  Mutation,
  {
    kind:
      | "field-datatype-configure"
      | "field-cardinality-configure"
      | "field-optionality-configure"
      | "field-initialization-expression-configure";
  }
> {
  return (
    mutation.kind === "field-datatype-configure" ||
    mutation.kind === "field-cardinality-configure" ||
    mutation.kind === "field-optionality-configure" ||
    mutation.kind === "field-initialization-expression-configure"
  );
}

function hasFieldDefinitionConfiguration(
  projection: Projection,
  contributionId: string,
  mutation: Extract<
    Mutation,
    {
      kind:
        | "field-datatype-configure"
        | "field-cardinality-configure"
        | "field-optionality-configure"
        | "field-initialization-expression-configure";
    }
  >,
): boolean {
  return (
    projection.fieldDefinitionConfigurations[mutation.fieldDefinitionId]?.some(
      (configuration) => configuration.contributionId === contributionId,
    ) ?? false
  );
}

function hasRemovedViewDefinitionStructure(
  projection: Projection,
  mutation: Extract<Mutation, { kind: "shared-default-view-definition-detach" }>,
): boolean {
  const trashNodeId = projection.workspaceSystemNodes.trash;
  const attachmentOccurrence = projection.occurrences[mutation.attachmentOccurrenceId];
  const relationDefinitionOccurrence = projection.occurrences[mutation.relationDefinitionOccurrenceId];
  const viewDefinitionOccurrence = projection.occurrences[mutation.viewDefinitionOccurrenceId];
  const detachedValueOccurrence = projection.occurrences[mutation.detachedValueOccurrenceId];
  const endpoints = projection.childOccurrences[mutation.attachmentNodeId] ?? [];
  return (
    trashNodeId !== undefined &&
    !Object.values(projection.sharedDefaultViewDefinitions).some((definitions) =>
      definitions.some((definition) => definition.attachmentNodeId === mutation.attachmentNodeId),
    ) &&
    projection.nodeOwners[mutation.attachmentNodeId] === trashNodeId &&
    attachmentOccurrence?.nodeId === mutation.attachmentNodeId &&
    attachmentOccurrence.parentNodeId === trashNodeId &&
    projection.nodeOwners[mutation.viewDefinitionNodeId] === trashNodeId &&
    viewDefinitionOccurrence?.nodeId === mutation.viewDefinitionNodeId &&
    viewDefinitionOccurrence.parentNodeId === trashNodeId &&
    relationDefinitionOccurrence?.nodeId === NODE_VIEWS_DEFINITION_NODE_ID &&
    relationDefinitionOccurrence.parentNodeId === mutation.attachmentNodeId &&
    projection.nodeOwners[mutation.detachedValueNodeId] === mutation.attachmentNodeId &&
    detachedValueOccurrence?.nodeId === mutation.detachedValueNodeId &&
    detachedValueOccurrence.parentNodeId === mutation.attachmentNodeId &&
    endpoints.length === 2 &&
    endpoints[0] === mutation.relationDefinitionOccurrenceId &&
    endpoints[1] === mutation.detachedValueOccurrenceId
  );
}

function hasRemovedSearchExpressionStructure(
  projection: Projection,
  mutation: Extract<Mutation, { kind: "search-expression-detach" }>,
): boolean {
  const trashNodeId = projection.workspaceSystemNodes.trash;
  const expressionOccurrence = projection.occurrences[mutation.expressionOccurrenceId];
  return (
    trashNodeId !== undefined &&
    projection.searchExpressions[mutation.searchNodeId] === undefined &&
    projection.nodeOwners[mutation.expressionNodeId] === trashNodeId &&
    expressionOccurrence?.nodeId === mutation.expressionNodeId &&
    expressionOccurrence.parentNodeId === trashNodeId &&
    projection.occurrences[mutation.definitionOccurrenceId] === undefined &&
    (projection.childOccurrences[mutation.expressionNodeId] ?? []).length === 0
  );
}

function hasMaterializedFieldStructure(
  projection: Projection,
  mutation: Extract<Mutation, { kind: "field-materialize" }>,
): boolean {
  const fieldOccurrence = projection.occurrences[mutation.fieldOccurrenceId];
  const definitionOccurrence = projection.occurrences[fieldDefinitionEndpointOccurrenceId(mutation.fieldOccurrenceId)];
  const datatypeConfigurations = (projection.fieldDefinitionConfigurations[mutation.fieldDefinitionId] ?? []).filter(
    (configuration) => configuration.kind === "datatype",
  );
  const datatype = datatypeConfigurations.length === 1 ? datatypeConfigurations[0]?.datatypeNodeId : undefined;
  const typedValue = projection.typedFieldValues[mutation.ownerNodeId]?.find(
    (field) => field.fieldDefinitionId === mutation.fieldDefinitionId && field.fieldNodeId === mutation.fieldNodeId,
  );
  const typedValueIsValid = !isTypedDatatype(datatype) || (typedValue !== undefined && typedValue.state !== "invalid");
  return (
    projection.nodes[mutation.fieldNodeId]?.intrinsicNodeType === "field" &&
    projection.nodes[mutation.fieldDefinitionId]?.intrinsicNodeType === "field-definition" &&
    projection.nodeOwners[mutation.fieldNodeId] === mutation.ownerNodeId &&
    fieldOccurrence?.nodeId === mutation.fieldNodeId &&
    fieldOccurrence.parentNodeId === mutation.ownerNodeId &&
    definitionOccurrence?.nodeId === mutation.fieldDefinitionId &&
    definitionOccurrence.parentNodeId === mutation.fieldNodeId &&
    projection.childOccurrences[mutation.fieldNodeId]?.[0] === definitionOccurrence.occurrenceId &&
    typedValueIsValid
  );
}

function isTypedDatatype(datatypeNodeId: string | undefined): boolean {
  return (
    datatypeNodeId === FIELD_DATATYPE_NODE_IDS.optionsFromSupertag ||
    datatypeNodeId === FIELD_DATATYPE_NODE_IDS.number ||
    datatypeNodeId === FIELD_DATATYPE_NODE_IDS.checkbox ||
    datatypeNodeId === FIELD_DATATYPE_NODE_IDS.date
  );
}
