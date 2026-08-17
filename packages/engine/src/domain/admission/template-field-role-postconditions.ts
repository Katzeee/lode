import type { Mutation } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateTemplateFieldPostcondition(
  mutation: Mutation,
  previous: Projection,
  projection: Projection,
): void {
  if (
    mutation.kind === "supertag-template-field-attach" ||
    mutation.kind === "supertag-template-field-existing-attach"
  ) {
    const field = projection.templateFields[mutation.supertagId]?.find(
      (candidate) => candidate.templateFieldNodeId === mutation.templateFieldNodeId,
    );
    const expectedOwner =
      mutation.kind === "supertag-template-field-existing-attach" ? "workspace-schema" : "template-field";
    const existingDefinitionIsDiscoverable =
      mutation.kind !== "supertag-template-field-existing-attach" ||
      (previous.nodes[mutation.fieldDefinitionId]?.intrinsicNodeType === "field-definition" &&
        previous.nodeOwners[mutation.fieldDefinitionId] === previous.workspaceSystemNodes.schema);
    if (
      field?.fieldDefinitionId !== mutation.fieldDefinitionId ||
      field.fieldDefinitionOwner !== expectedOwner ||
      !existingDefinitionIsDiscoverable
    ) {
      throw new Error(`Template Field structure is invalid: ${mutation.templateFieldNodeId}`);
    }
  }
  if (
    mutation.kind === "supertag-template-field-detach" &&
    Object.values(projection.templateFields).some((fields) =>
      fields.some((field) => field.templateFieldNodeId === mutation.templateFieldNodeId),
    )
  ) {
    throw new Error(`Removed Template Field structure is invalid: ${mutation.templateFieldNodeId}`);
  }
  if (mutation.kind === "supertag-template-field-discoverability-set") {
    const field = projection.templateFields[mutation.supertagId]?.find(
      (candidate) => candidate.templateFieldNodeId === mutation.templateFieldNodeId,
    );
    const previousField = previous.templateFields[mutation.supertagId]?.find(
      (candidate) => candidate.templateFieldNodeId === mutation.templateFieldNodeId,
    );
    if (
      field?.fieldDefinitionId !== mutation.fieldDefinitionId ||
      (field.fieldDefinitionOwner === "workspace-schema") !== mutation.discoverable ||
      previousField === undefined ||
      (previousField.fieldDefinitionOwner === "workspace-schema") !== mutation.previousDiscoverable
    ) {
      throw new Error(`Template Field discoverability is invalid: ${mutation.templateFieldNodeId}`);
    }
  }
  if (mutation.kind === "supertag-template-field-visibility-configure") {
    const field = projection.templateFields[mutation.supertagId]?.find(
      (candidate) => candidate.templateFieldNodeId === mutation.templateFieldNodeId,
    );
    if (
      field?.fieldDefinitionId !== mutation.fieldDefinitionId ||
      !field.visibilityCandidates.some((candidate) => candidate.visibility === mutation.visibility)
    ) {
      throw new Error(`Template Field visibility is invalid: ${mutation.templateFieldNodeId}`);
    }
  }
  if (
    mutation.kind === "supertag-optional-field-contribution-attach" &&
    !projection.optionalFieldContributions[mutation.supertagId]?.some(
      (field) =>
        field.contributionNodeId === mutation.contributionNodeId &&
        field.fieldDefinitionId === mutation.fieldDefinitionId,
    )
  ) {
    throw new Error(`Optional Field Contribution structure is invalid: ${mutation.contributionNodeId}`);
  }
  if (
    mutation.kind === "supertag-optional-field-contribution-detach" &&
    Object.values(projection.optionalFieldContributions).some((fields) =>
      fields.some((field) => field.contributionNodeId === mutation.contributionNodeId),
    )
  ) {
    throw new Error(`Detached Optional Field Contribution is invalid: ${mutation.contributionNodeId}`);
  }
}
