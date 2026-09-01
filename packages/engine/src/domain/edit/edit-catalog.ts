import type { GraphAction } from "../fact/index.js";
import { type EditFamilyDefinition, type EditOf } from "./edit-definition.js";
import { breadthEditDefinitions } from "./breadth-edit-definitions.js";
import { fieldDefinitionConfigurationEditDefinitions } from "./field-definition-configuration-edit-definitions.js";
import { searchEditDefinitions } from "./search-edit-definitions.js";
import { structuralEditDefinitions } from "./structural-edit-definitions.js";
import { supertagApplicationEditDefinitions } from "./supertag-application-edit-definitions.js";
import { templateFieldEditDefinitions } from "./template-field-edit-definitions.js";
import { typedFieldValueEditDefinitions } from "./typed-field-value-edit-definitions.js";
import { viewEditDefinitions } from "./view-edit-definitions.js";

export const EDIT_DEFINITIONS = {
  structural: structuralEditDefinitions,
  supertagApplication: supertagApplicationEditDefinitions,
  templateField: templateFieldEditDefinitions,
  fieldDefinitionConfiguration: fieldDefinitionConfigurationEditDefinitions,
  typedFieldValue: typedFieldValueEditDefinitions,
  breadth: breadthEditDefinitions,
  search: searchEditDefinitions,
  view: viewEditDefinitions,
} as const satisfies Readonly<Record<string, EditFamilyDefinition>>;

type ValueOf<Object> = Object[keyof Object];
type DefinitionByFamily = {
  [Family in keyof typeof EDIT_DEFINITIONS]: ValueOf<(typeof EDIT_DEFINITIONS)[Family]>;
};

type RegistryEditDefinition = ValueOf<DefinitionByFamily>;
export type RegistryEditAction = EditOf<RegistryEditDefinition>;
type RegistryEditKind = RegistryEditAction["kind"];

/** Edits whose expansion is declared on their definition (a required `plan`). */
type PlannedRegistryEditDefinition = Extract<RegistryEditDefinition, Readonly<{ plan: (edit: never) => unknown }>>;
export type PlannedEditAction = EditOf<PlannedRegistryEditDefinition>;

export function hasRegistryPlan<Edit extends Readonly<{ kind: string }>>(edit: Edit): edit is Edit & PlannedEditAction {
  return registryEditDefinition(edit.kind)?.plan !== undefined;
}

export function planRegistryEdit(edit: PlannedEditAction): readonly [GraphAction, ...GraphAction[]] {
  const plan = registryEditDefinition(edit.kind)?.plan;
  if (plan === undefined) {
    throw new Error(`Edit ${edit.kind} declares no registry plan`);
  }
  return (plan as (edit: PlannedEditAction) => readonly [GraphAction, ...GraphAction[]])(edit);
}

const DEFINITION_BY_KIND = new Map<RegistryEditKind, RegistryEditDefinition>();

for (const definitions of Object.values(EDIT_DEFINITIONS)) {
  for (const definition of Object.values(definitions) as unknown as readonly RegistryEditDefinition[]) {
    if (DEFINITION_BY_KIND.has(definition.kind)) {
      throw new Error(`Duplicate Edit kind: ${definition.kind}`);
    }
    DEFINITION_BY_KIND.set(definition.kind, definition);
  }
}

export function registryEditDefinition(kind: unknown): RegistryEditDefinition | undefined {
  return typeof kind === "string" ? DEFINITION_BY_KIND.get(kind as RegistryEditKind) : undefined;
}
