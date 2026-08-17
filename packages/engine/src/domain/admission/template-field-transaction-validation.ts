import type { ContributionFact } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";

type TemplateFieldDetachment = Extract<
  ContributionFact["body"]["mutation"],
  { kind: "supertag-template-field-detach" }
>;

export function validateRemovedTemplateFields(
  removals: readonly TemplateFieldDetachment[],
  projection: Projection,
): void {
  for (const mutation of removals) {
    if (
      Object.values(projection.templateFields).some((fields) =>
        fields.some((field) => field.templateFieldNodeId === mutation.templateFieldNodeId),
      )
    ) {
      continue;
    }
    const definition = projection.occurrences[mutation.definitionOccurrenceId];
    const defaultValue = projection.occurrences[mutation.staticDefaultValueOccurrenceId];
    const templateFieldPlacement = projection.occurrences[mutation.templateFieldOccurrenceId];
    const trashNodeId = projection.workspaceSystemNodes.trash;
    if (
      trashNodeId === undefined ||
      projection.nodeOwners[mutation.templateFieldNodeId] !== trashNodeId ||
      templateFieldPlacement?.nodeId !== mutation.templateFieldNodeId ||
      templateFieldPlacement.parentNodeId !== trashNodeId ||
      definition?.nodeId !== mutation.fieldDefinitionId ||
      definition.parentNodeId !== mutation.templateFieldNodeId ||
      defaultValue?.nodeId !== mutation.staticDefaultValueNodeId ||
      defaultValue.parentNodeId !== mutation.templateFieldNodeId ||
      projection.nodeOwners[mutation.staticDefaultValueNodeId] !== mutation.templateFieldNodeId
    ) {
      throw new Error(`Removed Template Field structure is invalid: ${mutation.templateFieldNodeId}`);
    }
  }
}
