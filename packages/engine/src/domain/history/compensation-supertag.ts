import {
  compareCausalOrder,
  isSupertagAction,
  type GraphAction,
  type FactAction,
  type FactActionId,
  type SupertagAction,
} from "../fact/index.js";
import { sequenceAnchorAt, type InterpretedProjection, type TemplateField } from "../reconcile/index.js";
import { compensateSupertagApplication } from "./compensation-supertag-application.js";
import { noCompensation, ready, type CompensationCatalog, type CompensationEntry } from "./compensation-types.js";

export const SUPERTAG_COMPENSATIONS = {
  "supertag-application-add": guarded(({ projection, counterfactual }, target) =>
    compensateSupertagApplication(target, projection, counterfactual),
  ),
  "supertag-membership-remove": guarded(({ projection, counterfactual }, target) =>
    compensateSupertagApplication(target, projection, counterfactual),
  ),
  "supertag-extension-add": guarded(({ projection }, { action }) =>
    contains(projection, action)
      ? ready([
          { kind: "supertag-extension-remove", supertagId: action.supertagId, baseSupertagId: action.baseSupertagId },
        ])
      : noCompensation(),
  ),
  "supertag-extension-remove": guarded(({ projection, counterfactual }, { action }) =>
    !contains(projection, action) && contains(counterfactual, action)
      ? ready([
          {
            kind: "supertag-extension-add",
            supertagId: action.supertagId,
            baseSupertagId: action.baseSupertagId,
            anchor: currentAnchor(counterfactual.supertagExtensions[action.supertagId] ?? [], action.baseSupertagId),
          },
        ])
      : noCompensation(),
  ),
  "template-member-add": guarded(({ projection }, { action }) =>
    contains(projection, action)
      ? ready([
          { kind: "template-member-remove", supertagId: action.supertagId, templateNodeId: action.templateNodeId },
        ])
      : noCompensation(),
  ),
  "template-member-remove": guarded(({ projection, counterfactual }, { action }) => {
    const occurrenceId = templateMemberOccurrence(counterfactual, action.supertagId, action.templateNodeId);
    return !contains(projection, action) && occurrenceId !== null
      ? ready([
          {
            kind: "template-member-add",
            supertagId: action.supertagId,
            templateNodeId: action.templateNodeId,
            anchor: currentAnchor(counterfactual.childOccurrences[action.supertagId] ?? [], occurrenceId),
          },
        ])
      : noCompensation();
  }),
  "template-field-add": guarded(({ projection }, target) =>
    templateFieldById(projection, target.id)
      ? ready([
          {
            kind: "template-field-remove",
            supertagId: target.action.supertagId,
            fieldDefinitionId: target.action.fieldDefinition.fieldDefinitionId,
          },
        ])
      : noCompensation(),
  ),
  "template-field-remove": guarded(({ projection, counterfactual }, { action }) => {
    const currentIds = new Set(
      templateFieldsForPair(projection, action.supertagId, action.fieldDefinitionId).map((field) => field.factActionId),
    );
    const restores = templateFieldsForPair(counterfactual, action.supertagId, action.fieldDefinitionId)
      .filter((field) => !currentIds.has(field.factActionId))
      .map((field): GraphAction => ({ kind: "template-field-restore", templateFieldId: field.factActionId }));
    return restores.length > 0 ? ready(restores) : noCompensation();
  }),
  "template-field-restore": guarded(({ projection }, { action }) => {
    const field = templateFieldById(projection, action.templateFieldId);
    return field
      ? ready([
          { kind: "template-field-remove", supertagId: field.supertagId, fieldDefinitionId: field.fieldDefinitionId },
        ])
      : noCompensation();
  }),
  "template-field-visibility-set": guarded(({ projection, counterfactual }, { action }) => {
    const current = templateFieldById(projection, action.templateFieldId);
    const previous = templateFieldById(counterfactual, action.templateFieldId);
    return current && previous
      ? ready([
          {
            kind: "template-field-visibility-set",
            templateFieldId: action.templateFieldId,
            visibility: previous.visibility,
          },
        ])
      : noCompensation();
  }),
  "template-field-static-default-set": guarded(({ projection, counterfactual }, { action }) => {
    const current = templateFieldById(projection, action.templateFieldId);
    const previous = templateFieldById(counterfactual, action.templateFieldId);
    const previousValues = new Set(previous?.staticDefaultCandidates.map((candidate) => candidate.value) ?? []);
    return current && previousValues.size <= 1
      ? ready([
          {
            kind: "template-field-static-default-set",
            templateFieldId: action.templateFieldId,
            value: previous?.staticDefaultCandidates[0]?.value ?? "",
          },
        ])
      : noCompensation();
  }),
  "optional-field-contribution-add": guarded(({ projection }, { action }) =>
    contains(projection, action)
      ? ready([
          {
            kind: "optional-field-contribution-remove",
            supertagId: action.supertagId,
            fieldDefinitionId: action.fieldDefinitionId,
          },
        ])
      : noCompensation(),
  ),
  "optional-field-contribution-remove": guarded(({ projection, counterfactual }, { action }) => {
    const previous = (counterfactual.optionalFieldContributions[action.supertagId] ?? []).find(
      (field) => field.fieldDefinitionId === action.fieldDefinitionId,
    );
    return previous && !contains(projection, action)
      ? ready([
          {
            kind: "optional-field-contribution-add",
            supertagId: action.supertagId,
            fieldDefinitionId: action.fieldDefinitionId,
            anchor: currentAnchor(
              counterfactual.childOccurrences[previous.nurseryValueNodeId] ?? [],
              previous.contributionOccurrenceId,
            ),
          },
        ])
      : noCompensation();
  }),
} satisfies Partial<CompensationCatalog>;

/**
 * Every supertag inverse is preempted by a later edit of the same relation:
 * the last writer owns the relation, so an earlier action has no effect left
 * to compensate.
 */
function guarded<Kind extends SupertagAction["kind"]>(entry: CompensationEntry<Kind>): CompensationEntry<Kind> {
  return (context, target) =>
    hasLaterRelationEdit(target, context.activeFacts) ? noCompensation() : entry(context, target);
}

function templateFieldById(
  projection: InterpretedProjection,
  templateFieldId: FactActionId,
): TemplateField | undefined {
  return Object.values(projection.templateFields)
    .flat()
    .find((field) => field.factActionId === templateFieldId);
}

function templateFieldsForPair(
  projection: InterpretedProjection,
  supertagId: string,
  fieldDefinitionId: string,
): readonly TemplateField[] {
  return (projection.templateFields[supertagId] ?? []).filter((field) => field.fieldDefinitionId === fieldDefinitionId);
}

function contains(projection: InterpretedProjection, action: SupertagAction): boolean {
  if (action.kind === "supertag-application-add" || action.kind === "supertag-membership-remove") {
    return (projection.supertagApplications[action.hostNodeId] ?? []).some(
      (application) => application.supertagId === action.supertagId,
    );
  }
  if (action.kind === "supertag-extension-add" || action.kind === "supertag-extension-remove") {
    return (projection.supertagExtensions[action.supertagId] ?? []).includes(action.baseSupertagId);
  }
  if (action.kind === "template-member-add" || action.kind === "template-member-remove") {
    return (projection.supertagTemplateNodes[action.supertagId] ?? []).includes(action.templateNodeId);
  }
  if (action.kind === "template-field-add") {
    return templateFieldsForPair(projection, action.supertagId, action.fieldDefinition.fieldDefinitionId).length > 0;
  }
  if (action.kind === "template-field-remove") {
    return templateFieldsForPair(projection, action.supertagId, action.fieldDefinitionId).length > 0;
  }
  if (
    action.kind === "template-field-restore" ||
    action.kind === "template-field-visibility-set" ||
    action.kind === "template-field-static-default-set"
  ) {
    return templateFieldById(projection, action.templateFieldId) !== undefined;
  }
  return (projection.optionalFieldContributions[action.supertagId] ?? []).some(
    (field) => field.fieldDefinitionId === action.fieldDefinitionId,
  );
}

function templateMemberOccurrence(
  projection: InterpretedProjection,
  supertagId: string,
  templateNodeId: string,
): string | null {
  return (
    projection.childOccurrences[supertagId]?.find(
      (occurrenceId) => projection.occurrences[occurrenceId]?.nodeId === templateNodeId,
    ) ?? null
  );
}

function currentAnchor(identities: readonly string[], identity: string) {
  return sequenceAnchorAt(identities, identities.indexOf(identity));
}

function hasLaterRelationEdit(target: FactAction, activeFacts: readonly FactAction[]): boolean {
  const action = target.action;
  if (!isSupertagAction(action)) {
    return false;
  }
  const owner = relationOwner(action, activeFacts);
  return activeFacts.some(
    (fact) =>
      compareCausalOrder(target, fact) < 0 &&
      isSupertagAction(fact.action) &&
      relationOwner(fact.action, activeFacts) === owner,
  );
}

function relationOwner(action: SupertagAction, facts: readonly FactAction[]): string {
  if (action.kind === "supertag-application-add" || action.kind === "supertag-membership-remove") {
    return JSON.stringify(["application", action.hostNodeId, action.supertagId]);
  }
  if (action.kind === "supertag-extension-add" || action.kind === "supertag-extension-remove") {
    return JSON.stringify(["extension", action.supertagId, action.baseSupertagId]);
  }
  if (action.kind === "template-member-add" || action.kind === "template-member-remove") {
    return JSON.stringify(["template-node", action.supertagId, action.templateNodeId]);
  }
  if (action.kind === "template-field-add") {
    return JSON.stringify(["template-field", action.supertagId, action.fieldDefinition.fieldDefinitionId]);
  }
  if (action.kind === "template-field-remove") {
    return JSON.stringify(["template-field", action.supertagId, action.fieldDefinitionId]);
  }
  if (
    action.kind === "template-field-restore" ||
    action.kind === "template-field-visibility-set" ||
    action.kind === "template-field-static-default-set"
  ) {
    const addition = facts.find((fact) => fact.id === action.templateFieldId)?.action;
    return addition?.kind === "template-field-add"
      ? JSON.stringify(["template-field", addition.supertagId, addition.fieldDefinition.fieldDefinitionId])
      : JSON.stringify(["template-field", action.templateFieldId]);
  }
  return JSON.stringify(["optional-field", action.supertagId, action.fieldDefinitionId]);
}
