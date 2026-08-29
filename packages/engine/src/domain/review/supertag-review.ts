import { isSupertagAction, type FactAction, type SupertagAction } from "../fact/index.js";
import { impactAddress, type InterpretedProjection, type InterpretedProjectionGeneration } from "../reconcile/index.js";
import type { SupertagRelationDecisionEffect } from "./types.js";

export function supertagRelationEffect(
  fact: FactAction,
  generation: InterpretedProjectionGeneration,
): SupertagRelationDecisionEffect {
  const action = fact.action;
  if (!isSupertagAction(action)) {
    throw new Error("Supertag relation effect requires a Supertag relation AuthoredAction");
  }
  const relation = supertagRelationKind(action);
  const [ownerId, targetId] = supertagRelationIdentities(action, generation);
  return {
    kind: "supertag-relation",
    relation,
    ownerId,
    targetId,
    originIndex: relationIndex(generation.origin, relation, ownerId, targetId),
    reviewIndex: relationIndex(generation.review, relation, ownerId, targetId),
  };
}

function restoredTemplateFieldIdentities(
  templateFieldId: string,
  generation: InterpretedProjectionGeneration,
): readonly [string, string] {
  const field = [...Object.values(generation.origin.templateFields), ...Object.values(generation.review.templateFields)]
    .flat()
    .find((candidate) => candidate.factActionId === templateFieldId);
  return field ? [field.supertagId, field.fieldDefinitionId] : [templateFieldId, templateFieldId];
}

export function addSupertagRelationImpacts(
  impacts: Set<string>,
  fact: FactAction,
  generation: InterpretedProjectionGeneration,
): void {
  const action = fact.action;
  if (!isSupertagAction(action)) {
    return;
  }
  impacts.add(supertagRelationAddress(action, generation));
  if (action.kind === "template-member-add" || action.kind === "template-member-remove") {
    for (const instance of [...generation.origin.templateNodeInstances, ...generation.review.templateNodeInstances]) {
      if (
        instance.templateNodeId === action.templateNodeId &&
        instance.sources.some((source) => source.supertagId === action.supertagId)
      ) {
        impacts.add(instance.instanceOccurrenceId);
        impacts.add(impactAddress("template-node", instance.ownerNodeId, instance.templateNodeId));
      }
    }
  }
}

export function supertagRelationAddress(action: SupertagAction, generation: InterpretedProjectionGeneration): string {
  const relation = supertagRelationKind(action);
  const [ownerId, targetId] = supertagRelationIdentities(action, generation);
  return impactAddress(`supertag-${relation}`, ownerId, targetId);
}

function relationIndex(
  projection: InterpretedProjection,
  relation: SupertagRelationDecisionEffect["relation"],
  ownerId: string,
  targetId: string,
): number | null {
  if (relation === "template-field") {
    const count = (projection.templateFields[ownerId] ?? []).filter(
      (field) => field.fieldDefinitionId === targetId,
    ).length;
    return count === 0 ? null : count;
  }
  if (relation === "optional-field") {
    const count = (projection.optionalFieldContributions[ownerId] ?? []).filter(
      (field) => field.fieldDefinitionId === targetId,
    ).length;
    return count === 0 ? null : count;
  }
  if (relation === "template-field-visibility") {
    const field = Object.values(projection.templateFields)
      .flat()
      .find((candidate) => candidate.factActionId === ownerId);
    return field === undefined ? null : field.visibility === "pinned" ? 1 : 0;
  }
  if (relation === "template-field-static-default") {
    const field = Object.values(projection.templateFields)
      .flat()
      .find((candidate) => candidate.factActionId === ownerId);
    return field?.staticDefaultCandidates.some((candidate) => candidate.value === targetId) ? 1 : null;
  }
  const values =
    relation === "application"
      ? projection.supertagApplications[ownerId]
      : relation === "extension"
        ? projection.supertagExtensions[ownerId]
        : projection.supertagTemplateNodes[ownerId];
  const index =
    relation === "application"
      ? (values as InterpretedProjection["supertagApplications"][string] | undefined)?.findIndex(
          (application) => application.supertagId === targetId,
        )
      : (values as readonly string[] | undefined)?.indexOf(targetId);
  return index === undefined || index < 0 ? null : index;
}

function supertagRelationKind(action: SupertagAction): SupertagRelationDecisionEffect["relation"] {
  if (action.kind === "supertag-application-add" || action.kind === "supertag-membership-remove") {
    return "application";
  }
  if (action.kind === "supertag-extension-add" || action.kind === "supertag-extension-remove") {
    return "extension";
  }
  if (action.kind === "template-member-add" || action.kind === "template-member-remove") {
    return "template-node";
  }
  if (action.kind === "template-field-visibility-set") {
    return "template-field-visibility";
  }
  if (action.kind === "template-field-static-default-set") {
    return "template-field-static-default";
  }
  if (action.kind === "optional-field-contribution-add" || action.kind === "optional-field-contribution-remove") {
    return "optional-field";
  }
  return "template-field";
}

function supertagRelationIdentities(
  action: SupertagAction,
  generation: InterpretedProjectionGeneration,
): readonly [string, string] {
  if (action.kind === "supertag-application-add" || action.kind === "supertag-membership-remove") {
    return [action.hostNodeId, action.supertagId];
  }
  if (action.kind === "supertag-extension-add" || action.kind === "supertag-extension-remove") {
    return [action.supertagId, action.baseSupertagId];
  }
  if (action.kind === "template-member-add" || action.kind === "template-member-remove") {
    return [action.supertagId, action.templateNodeId];
  }
  if (action.kind === "template-field-add") {
    return [action.supertagId, action.fieldDefinition.fieldDefinitionId];
  }
  if (action.kind === "template-field-remove") {
    return [action.supertagId, action.fieldDefinitionId];
  }
  if (action.kind === "template-field-static-default-set") {
    return [action.templateFieldId, action.value];
  }
  if (action.kind === "template-field-visibility-set") {
    return [action.templateFieldId, action.visibility];
  }
  if (action.kind === "template-field-restore") {
    return restoredTemplateFieldIdentities(action.templateFieldId, generation);
  }
  return [action.supertagId, action.fieldDefinitionId];
}
