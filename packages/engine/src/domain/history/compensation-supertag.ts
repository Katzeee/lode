import {
  compareCausalOrder,
  isSupertagAction,
  type GraphAction,
  type FactAction,
  type FactActionId,
  type SupertagAction,
} from "../fact/index.js";
import { sequenceAnchorAt, type ScopedProjection, type TemplateField } from "../reconcile/index.js";
import { compensateSupertagApplication } from "./compensation-supertag-application.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateSupertagAction(
  target: FactAction,
  activeFacts: readonly FactAction[],
  projection: ScopedProjection,
  counterfactual: ScopedProjection,
): CompensationStep | null {
  const action = target.action;
  if (!isSupertagAction(action)) {
    return null;
  }
  if (hasLaterRelationEdit(target, activeFacts)) {
    return noCompensation();
  }
  if (action.kind === "supertag-application-add" || action.kind === "supertag-membership-remove") {
    return compensateSupertagApplication(
      target as FactAction & Readonly<{ action: typeof action }>,
      projection,
      counterfactual,
    );
  }
  if (action.kind === "supertag-extension-add") {
    return contains(projection, action)
      ? ready([
          { kind: "supertag-extension-remove", supertagId: action.supertagId, baseSupertagId: action.baseSupertagId },
        ])
      : noCompensation();
  }
  if (action.kind === "supertag-extension-remove") {
    return !contains(projection, action) && contains(counterfactual, action)
      ? ready([
          {
            kind: "supertag-extension-add",
            supertagId: action.supertagId,
            baseSupertagId: action.baseSupertagId,
            anchor: currentAnchor(counterfactual.supertagExtensions[action.supertagId] ?? [], action.baseSupertagId),
          },
        ])
      : noCompensation();
  }
  if (action.kind === "template-member-add" || action.kind === "template-member-remove") {
    return compensateTemplateNodeRelation(action, projection, counterfactual);
  }
  if (
    action.kind === "template-field-add" ||
    action.kind === "template-field-remove" ||
    action.kind === "template-field-restore" ||
    action.kind === "template-field-visibility-set" ||
    action.kind === "template-field-static-default-set"
  ) {
    return compensateTemplateField(action, target.id, projection, counterfactual);
  }
  if (action.kind === "optional-field-contribution-add") {
    return contains(projection, action)
      ? ready([
          {
            kind: "optional-field-contribution-remove",
            supertagId: action.supertagId,
            fieldDefinitionId: action.fieldDefinitionId,
          },
        ])
      : noCompensation();
  }
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
}

function compensateTemplateField(
  action: Extract<
    SupertagAction,
    {
      kind:
        | "template-field-add"
        | "template-field-remove"
        | "template-field-restore"
        | "template-field-visibility-set"
        | "template-field-static-default-set";
    }
  >,
  actionId: FactActionId,
  projection: ScopedProjection,
  counterfactual: ScopedProjection,
): CompensationStep {
  if (action.kind === "template-field-add") {
    return templateFieldById(projection, actionId)
      ? ready([
          {
            kind: "template-field-remove",
            supertagId: action.supertagId,
            fieldDefinitionId: action.fieldDefinition.fieldDefinitionId,
          },
        ])
      : noCompensation();
  }
  if (action.kind === "template-field-remove") {
    const currentIds = new Set(
      templateFieldsForPair(projection, action.supertagId, action.fieldDefinitionId).map((field) => field.factActionId),
    );
    const restores = templateFieldsForPair(counterfactual, action.supertagId, action.fieldDefinitionId)
      .filter((field) => !currentIds.has(field.factActionId))
      .map((field): GraphAction => ({ kind: "template-field-restore", templateFieldId: field.factActionId }));
    return restores.length > 0 ? ready(restores) : noCompensation();
  }
  if (action.kind === "template-field-restore") {
    const field = templateFieldById(projection, action.templateFieldId);
    return field
      ? ready([
          { kind: "template-field-remove", supertagId: field.supertagId, fieldDefinitionId: field.fieldDefinitionId },
        ])
      : noCompensation();
  }
  if (action.kind === "template-field-visibility-set") {
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
  }
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
}

function compensateTemplateNodeRelation(
  action: Extract<GraphAction, { kind: "template-member-add" | "template-member-remove" }>,
  projection: ScopedProjection,
  counterfactual: ScopedProjection,
): CompensationStep {
  if (action.kind === "template-member-add") {
    return contains(projection, action)
      ? ready([
          { kind: "template-member-remove", supertagId: action.supertagId, templateNodeId: action.templateNodeId },
        ])
      : noCompensation();
  }
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
}

function templateFieldById(projection: ScopedProjection, templateFieldId: FactActionId): TemplateField | undefined {
  return Object.values(projection.templateFields)
    .flat()
    .find((field) => field.factActionId === templateFieldId);
}

function templateFieldsForPair(
  projection: ScopedProjection,
  supertagId: string,
  fieldDefinitionId: string,
): readonly TemplateField[] {
  return (projection.templateFields[supertagId] ?? []).filter((field) => field.fieldDefinitionId === fieldDefinitionId);
}

function ready(actions: readonly GraphAction[]): CompensationStep {
  const first = actions[0];
  return first ? { kind: "ready", actions: [first, ...actions.slice(1)] } : noCompensation();
}

function contains(projection: ScopedProjection, action: SupertagAction): boolean {
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
  projection: ScopedProjection,
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
