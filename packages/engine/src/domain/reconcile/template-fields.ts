import { causalMaxima, stableStringCompare, type FactAction, type FactActionOf } from "../fact/index.js";
import type { MutableOccurrence } from "./projection-state.js";
import type { OptionalFieldContribution, TemplateField } from "./projection-types.js";
import { optionalFieldStates } from "./optional-field-graph.js";
import { templateFieldStates, templateFieldStaticDefaultCandidates } from "./template-field-graph.js";

type TemplateFieldGraph = Readonly<{
  templateFields: Readonly<Record<string, readonly TemplateField[]>>;
  optionalFieldContributions: Readonly<Record<string, readonly OptionalFieldContribution[]>>;
}>;

type NodeIdentityProjection = Readonly<Record<string, Readonly<{ intrinsicNodeType: string | null }>>>;

export function projectTemplateFieldGraph(
  active: readonly FactAction[],
  _workspaceNodeId: string,
  _nodes: NodeIdentityProjection,
  _occurrences: ReadonlyMap<string, MutableOccurrence>,
  childOccurrences: ReadonlyMap<string, readonly string[]>,
  _nodeOwners: Readonly<Record<string, string | null>>,
  _metanodes: Readonly<Record<string, string>>,
): TemplateFieldGraph {
  return {
    templateFields: projectTemplateFields(active, childOccurrences),
    optionalFieldContributions: projectOptionalFieldContributions(active, childOccurrences),
  };
}

function projectTemplateFields(
  active: readonly FactAction[],
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly TemplateField[]>> {
  const fields = templateFieldStates(active).flatMap((state): readonly TemplateField[] => {
    if (state.removed) {
      return [];
    }
    const visibilityActions = causalMaxima(
      active.filter(
        (action): action is FactActionOf<"template-field-visibility-set"> =>
          action.action.kind === "template-field-visibility-set" && action.action.templateFieldId === state.addition.id,
      ),
      (left, right) => left.action.templateFieldId === right.action.templateFieldId,
    );
    const visibilityCandidates = visibilityActions.map((action) => ({
      visibility: action.action.visibility,
      factActionId: action.id,
    }));
    const visibilityValues = new Set(visibilityCandidates.map((candidate) => candidate.visibility));
    const staticDefaultCandidates = templateFieldStaticDefaultCandidates(active, state.addition.id).map((action) => ({
      value: action.action.value,
      factActionId: action.id,
    }));
    const staticDefaultValues = new Set(staticDefaultCandidates.map((candidate) => candidate.value));
    return [
      {
        supertagId: state.addition.action.supertagId,
        ...state.identity,
        fieldDefinitionId: state.addition.action.fieldDefinition.fieldDefinitionId,
        fieldDefinitionOwner: state.fieldDefinitionOwner,
        factActionId: state.addition.id,
        visibility: visibilityCandidates.some((candidate) => candidate.visibility === "pinned") ? "pinned" : "normal",
        visibilityCandidates,
        visibilityConflicted: visibilityValues.size > 1,
        staticDefaultCandidates,
        staticDefaultConflicted: staticDefaultValues.size > 1,
      },
    ];
  });
  return orderedBySupertag(fields, childOccurrences);
}

function projectOptionalFieldContributions(
  active: readonly FactAction[],
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly OptionalFieldContribution[]>> {
  const fields = optionalFieldStates(active).flatMap((state): readonly OptionalFieldContribution[] =>
    state.removed
      ? []
      : [
          {
            supertagId: state.addition.action.supertagId,
            ...state.identity,
            fieldDefinitionId: state.addition.action.fieldDefinitionId,
            factActionId: state.addition.id,
          },
        ],
  );
  return orderedOptionalBySupertag(fields, childOccurrences);
}

function orderedBySupertag(
  values: readonly TemplateField[],
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly TemplateField[]>> {
  return Object.fromEntries(
    unique(values.map((value) => value.supertagId))
      .sort(stableStringCompare)
      .map((supertagId) => {
        const order = childOccurrences.get(supertagId) ?? [];
        return [
          supertagId,
          values
            .filter((value) => value.supertagId === supertagId)
            .sort(
              (left, right) =>
                order.indexOf(left.templateFieldOccurrenceId) - order.indexOf(right.templateFieldOccurrenceId) ||
                compareCausalOrderById(left.factActionId, right.factActionId),
            ),
        ];
      }),
  );
}

function orderedOptionalBySupertag(
  values: readonly OptionalFieldContribution[],
  childOccurrences: ReadonlyMap<string, readonly string[]>,
): Readonly<Record<string, readonly OptionalFieldContribution[]>> {
  return Object.fromEntries(
    unique(values.map((value) => value.supertagId))
      .sort(stableStringCompare)
      .map((supertagId) => [
        supertagId,
        values
          .filter((value) => value.supertagId === supertagId)
          .sort((left, right) => {
            const leftOrder = childOccurrences.get(left.nurseryValueNodeId) ?? [];
            const rightOrder = childOccurrences.get(right.nurseryValueNodeId) ?? [];
            return (
              (left.fieldNurseryNodeId === right.fieldNurseryNodeId
                ? leftOrder.indexOf(left.contributionOccurrenceId) - rightOrder.indexOf(right.contributionOccurrenceId)
                : stableStringCompare(left.fieldNurseryNodeId, right.fieldNurseryNodeId)) ||
              stableStringCompare(left.contributionNodeId, right.contributionNodeId)
            );
          }),
      ]),
  );
}

function compareCausalOrderById(left: string, right: string): number {
  return stableStringCompare(left, right);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
