import {
  type ActionAdmission,
  type ActionContributionsOf,
  type ActionEditAccess,
  type ActionFamilyDefinition,
  type ActionOf,
  type AnyActionDefinition,
} from "./action-definition.js";
import { fieldActionDefinitions, fieldDefinitionActionDefinitions } from "./field-action-definitions.js";
import { inlineReferenceActionDefinitions } from "./inline-reference-action-definitions.js";
import { searchActionDefinitions } from "./search-action-definitions.js";
import {
  nodeActionDefinitions,
  placementActionDefinitions,
  templateActionDefinitions,
} from "./structural-action-definitions.js";
import { supertagActionDefinitions } from "./supertag-action-definitions.js";
import { textActionDefinitions } from "./text-action-definitions.js";
import { viewActionDefinitions } from "./view-action-definitions.js";
import type { CollectionName, SemanticContribution } from "./action-contribution-types.js";
import { ShapeValidationError } from "../../decoding/index.js";

export const ACTION_DEFINITIONS = {
  node: nodeActionDefinitions,
  placement: placementActionDefinitions,
  supertag: supertagActionDefinitions,
  template: templateActionDefinitions,
  field: fieldActionDefinitions,
  fieldDefinition: fieldDefinitionActionDefinitions,
  text: textActionDefinitions,
  inlineReference: inlineReferenceActionDefinitions,
  search: searchActionDefinitions,
  view: viewActionDefinitions,
} as const satisfies Readonly<Record<string, ActionFamilyDefinition>>;

type ValueOf<Object> = Object[keyof Object];
type DefinitionByFamily = {
  [Family in keyof typeof ACTION_DEFINITIONS]: ValueOf<(typeof ACTION_DEFINITIONS)[Family]>;
};

type AuthoredActionDefinition = ValueOf<DefinitionByFamily>;
export type AuthoredAction = ActionOf<AuthoredActionDefinition>;
type AuthoredActionKind = AuthoredAction["kind"];
export type ActionFamily = keyof typeof ACTION_DEFINITIONS;

type DefinitionWithAdmission<Admission extends ActionAdmission> = Extract<
  AuthoredActionDefinition,
  Readonly<{ admission: Admission }>
>;

export type ProposableAction = ActionOf<DefinitionWithAdmission<"proposable">>;
export type TerminalAction = ActionOf<DefinitionWithAdmission<"terminal">>;
export type GraphAction = ActionOf<DefinitionWithAdmission<"proposable" | "direct-only">>;

type DefinitionWithEditAccess<Access extends ActionEditAccess> = Extract<
  AuthoredActionDefinition,
  Readonly<{ editAccess: Access }>
>;

export type GraphActionKindWithEditAccess<Access extends ActionEditAccess> = Extract<
  GraphAction,
  ActionOf<DefinitionWithEditAccess<Access>>
>["kind"];

type DefinitionInFamily<Family extends ActionFamily> = DefinitionByFamily[Family];
type ActionKindInFamily<Family extends ActionFamily> =
  ActionOf<DefinitionInFamily<Family>> extends Readonly<{
    kind: infer Kind;
  }>
    ? Kind
    : never;
export type ActionInFamily<Family extends ActionFamily> = Extract<
  AuthoredAction,
  Readonly<{ kind: ActionKindInFamily<Family> }>
>;

type AdditionKindInDefinition<Definition, Collection extends CollectionName> = Definition extends AnyActionDefinition
  ? Extract<
      ActionContributionsOf<Definition>[number],
      Readonly<{ kind: "causal-collection"; collection: Collection; operation: "add" }>
    > extends never
    ? never
    : ActionOf<Definition>["kind"]
  : never;

export type ActionKindAddingToCollection<Collection extends CollectionName> = AdditionKindInDefinition<
  AuthoredActionDefinition,
  Collection
>;

const DEFINITION_BY_KIND = new Map<AuthoredActionKind, AuthoredActionDefinition>();
const FAMILY_BY_KIND = new Map<AuthoredActionKind, ActionFamily>();

for (const [family, definitions] of Object.entries(ACTION_DEFINITIONS) as readonly [
  ActionFamily,
  ActionFamilyDefinition,
][]) {
  for (const definition of Object.values(definitions) as unknown as readonly AuthoredActionDefinition[]) {
    if (DEFINITION_BY_KIND.has(definition.kind)) {
      throw new Error(`Duplicate Authored Action kind: ${definition.kind}`);
    }
    DEFINITION_BY_KIND.set(definition.kind, definition);
    FAMILY_BY_KIND.set(definition.kind, family);
  }
}

export function parseCatalogAction(value: unknown): AuthoredAction {
  const kind = readActionKind(value);
  const definition = kind === undefined ? undefined : DEFINITION_BY_KIND.get(kind as AuthoredActionKind);
  if (!definition) {
    throw new ShapeValidationError(`Unknown AuthoredAction kind: ${String(kind)}`);
  }
  return definition.parse(value);
}

export function catalogActionContributions(action: AuthoredAction): readonly SemanticContribution[] {
  const definition = DEFINITION_BY_KIND.get(action.kind);
  if (definition === undefined) {
    throw new ShapeValidationError(`Unknown AuthoredAction kind: ${action.kind}`);
  }
  return contributionsFromDefinition(definition, action);
}

function contributionsFromDefinition<Definition extends AnyActionDefinition>(
  definition: Definition,
  action: AuthoredAction,
): readonly SemanticContribution[] {
  return definition.contributions(action);
}

export function actionBelongsToFamily<Family extends ActionFamily>(
  action: AuthoredAction,
  family: Family,
): action is ActionInFamily<Family> {
  return FAMILY_BY_KIND.get(action.kind) === family;
}

export function graphActionKindsInFamily<Family extends ActionFamily>(
  family: Family,
): readonly Extract<ActionInFamily<Family>, GraphAction>["kind"][] {
  const definitions = Object.values(ACTION_DEFINITIONS[family]) as unknown as readonly AuthoredActionDefinition[];
  return definitions
    .filter((definition) => definition.admission !== "terminal")
    .map((definition) => definition.kind) as unknown as readonly Extract<ActionInFamily<Family>, GraphAction>["kind"][];
}

export function proposableActionKindsInFamily<Family extends ActionFamily>(
  family: Family,
): readonly Extract<ActionInFamily<Family>, ProposableAction>["kind"][] {
  const definitions = Object.values(ACTION_DEFINITIONS[family]) as unknown as readonly AuthoredActionDefinition[];
  return definitions
    .filter((definition) => definition.admission === "proposable")
    .map((definition) => definition.kind) as unknown as readonly Extract<
    ActionInFamily<Family>,
    ProposableAction
  >["kind"][];
}

export function actionHasEditAccess<Access extends ActionEditAccess>(
  action: AuthoredAction,
  access: Access,
): action is Extract<GraphAction, ActionOf<DefinitionWithEditAccess<Access>>> {
  const definition = DEFINITION_BY_KIND.get(action.kind);
  return definition !== undefined && definition.admission !== "terminal" && definition.editAccess === access;
}

export function actionHasAdmission<Admission extends ActionAdmission>(
  action: AuthoredAction,
  admission: Admission,
): action is ActionOf<DefinitionWithAdmission<Admission>> {
  return DEFINITION_BY_KIND.get(action.kind)?.admission === admission;
}

export function isCatalogGraphAction(action: AuthoredAction): action is GraphAction {
  return DEFINITION_BY_KIND.get(action.kind)?.admission !== "terminal";
}

function readActionKind(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && "kind" in value && typeof value.kind === "string"
    ? value.kind
    : undefined;
}
