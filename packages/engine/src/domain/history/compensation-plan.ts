import { ACTION_DEFINITIONS, type AuthoredAction, type FactAction } from "../fact/index.js";
import { compensateContentAction } from "./compensation-content.js";
import { compensateFieldDefinitionConfiguration } from "./compensation-field-definition.js";
import { compensateInlineReferenceAction } from "./compensation-inline-reference.js";
import { compensateSearchAction } from "./compensation-search.js";
import { compensateStructureAction } from "./compensation-structure.js";
import { compensateSupertagAction } from "./compensation-supertag.js";
import {
  noCompensation,
  type CompensationRule,
  type CompensationRuleContext,
  type CompensationStep,
  type CompensationTargetAction,
} from "./compensation-types.js";
import { compensateViewAction } from "./compensation-view.js";

type ActionToken = Readonly<{ kind: CompensationTargetAction["kind"] }>;
type CompensationFamily<Definitions extends readonly ActionToken[] = readonly ActionToken[]> = Readonly<{
  key: string;
  definitions: Definitions;
  compensate: CompensationRule;
}>;

const compensateStructure: CompensationRule = ({ targetIds, activeFacts, projection, counterfactual }, target) =>
  compensateStructureAction(target, targetIds, activeFacts, projection, counterfactual);

const COMPENSATION_FAMILIES = [
  registerActions(
    "structure",
    compensateStructure,
    ACTION_DEFINITIONS.node.create,
    ACTION_DEFINITIONS.node.trash,
    ACTION_DEFINITIONS.node.restore,
    ACTION_DEFINITIONS.node.promoteOriginal,
  ),
  registerFamily("structure", compensateStructure, ACTION_DEFINITIONS.placement),
  registerFamily(
    "supertag",
    ({ activeFacts, projection, counterfactual }, target) =>
      compensateSupertagAction(target, activeFacts, projection, counterfactual),
    ACTION_DEFINITIONS.supertag,
  ),
  registerActions(
    "no-compensation",
    () => noCompensation(),
    ACTION_DEFINITIONS.template.detachNode,
    ACTION_DEFINITIONS.field.materialize,
  ),
  registerActions(
    "structure",
    compensateStructure,
    ACTION_DEFINITIONS.field.removeValue,
    ACTION_DEFINITIONS.field.clearMaterialized,
  ),
  registerFamily(
    "field-definition",
    ({ projection, counterfactual }, target) =>
      compensateFieldDefinitionConfiguration(target, projection, counterfactual),
    ACTION_DEFINITIONS.fieldDefinition,
  ),
  registerFamily(
    "content",
    ({ targetIds, activeFacts, projection, counterfactual }, target) =>
      compensateContentAction(target, targetIds, activeFacts, projection, counterfactual),
    ACTION_DEFINITIONS.text,
  ),
  registerFamily(
    "inline-reference",
    ({ projection, counterfactual }, target) => compensateInlineReferenceAction(target, projection, counterfactual),
    ACTION_DEFINITIONS.inlineReference,
  ),
  registerFamily(
    "search",
    ({ counterfactual }, target) => compensateSearchAction(target, counterfactual),
    ACTION_DEFINITIONS.search,
  ),
  registerFamily(
    "view",
    ({ activeFacts, projection, counterfactual }, target) =>
      compensateViewAction(target, activeFacts, projection, counterfactual),
    ACTION_DEFINITIONS.view,
  ),
] as const satisfies readonly CompensationFamily[];

const FAMILY_BY_ACTION = compileCompensationPlan(COMPENSATION_FAMILIES);

export function isCompensationTargetAction(action: AuthoredAction): action is CompensationTargetAction {
  return FAMILY_BY_ACTION.has(action.kind as CompensationTargetAction["kind"]);
}

export function compensateAction(
  target: FactAction<CompensationTargetAction>,
  context: CompensationRuleContext,
): CompensationStep {
  const family = FAMILY_BY_ACTION.get(target.action.kind);
  if (family === undefined) {
    throw new Error(`History Compensation family is missing for ${target.action.kind}`);
  }
  const step = family.compensate(context, target);
  if (step === null) {
    throw new Error(`Compensation family ${family.key} did not handle ${target.action.kind}`);
  }
  return step;
}

function registerActions<const Definitions extends readonly ActionToken[]>(
  key: string,
  compensate: CompensationRule,
  ...definitions: Definitions
): CompensationFamily<Definitions> {
  return { key, definitions, compensate };
}

function registerFamily<const Family extends Readonly<Record<string, ActionToken>>>(
  key: string,
  compensate: CompensationRule,
  family: Family,
): CompensationFamily<readonly Family[keyof Family][]> {
  return { key, definitions: Object.values(family) as unknown as readonly Family[keyof Family][], compensate };
}

type RegisteredActionKind<Families extends readonly CompensationFamily[]> =
  Families[number]["definitions"][number]["kind"];
type CompleteCompensationPlan<Families extends readonly CompensationFamily[]> =
  Exclude<CompensationTargetAction["kind"], RegisteredActionKind<Families>> extends never ? unknown : never;

function compileCompensationPlan<const Families extends readonly CompensationFamily[]>(
  families: Families & CompleteCompensationPlan<Families>,
): ReadonlyMap<CompensationTargetAction["kind"], CompensationFamily> {
  const byAction = new Map<CompensationTargetAction["kind"], CompensationFamily>();
  for (const family of families) {
    for (const definition of family.definitions) {
      const owner = byAction.get(definition.kind);
      if (owner !== undefined) {
        throw new Error(
          `History Compensation ${definition.kind} has duplicate family owners: ${owner.key}, ${family.key}`,
        );
      }
      byAction.set(definition.kind, family);
    }
  }
  return byAction;
}
