import { ACTION_DEFINITIONS, type AuthoredAction, type GraphAction } from "../fact/index.js";

export type CompensationPolicy =
  "content" | "structure" | "supertag" | "inline-reference" | "field-definition" | "search" | "view" | "none";

type ActionToken = Readonly<{ kind: AuthoredAction["kind"] }>;
type PolicyRegistration<Definitions extends readonly ActionToken[] = readonly ActionToken[]> = Readonly<{
  policy: CompensationPolicy;
  definitions: Definitions;
}>;

const HISTORY_POLICY_REGISTRATIONS = [
  registerActions(
    "structure",
    ACTION_DEFINITIONS.node.create,
    ACTION_DEFINITIONS.node.trash,
    ACTION_DEFINITIONS.node.restore,
    ACTION_DEFINITIONS.node.promoteOriginal,
  ),
  registerFamily("structure", ACTION_DEFINITIONS.placement),
  registerFamily("supertag", ACTION_DEFINITIONS.supertag),
  registerActions("none", ACTION_DEFINITIONS.template.detachNode, ACTION_DEFINITIONS.field.materialize),
  registerActions("structure", ACTION_DEFINITIONS.field.removeValue, ACTION_DEFINITIONS.field.clearMaterialized),
  registerFamily("field-definition", ACTION_DEFINITIONS.fieldDefinition),
  registerFamily("content", ACTION_DEFINITIONS.text),
  registerFamily("inline-reference", ACTION_DEFINITIONS.inlineReference),
  registerFamily("search", ACTION_DEFINITIONS.search),
  registerFamily("view", ACTION_DEFINITIONS.view),
] as const satisfies readonly PolicyRegistration[];

type RegisteredActionToken = (typeof HISTORY_POLICY_REGISTRATIONS)[number]["definitions"][number];
type CompensationTargetKind = RegisteredActionToken["kind"];

export type CompensationTargetAction = Extract<AuthoredAction, { kind: CompensationTargetKind }>;

export const COMPENSATION_POLICY_BY_ACTION = compilePolicy(HISTORY_POLICY_REGISTRATIONS);

export function isCompensationTargetAction(action: AuthoredAction): action is CompensationTargetAction {
  return COMPENSATION_POLICY_BY_ACTION.has(action.kind as CompensationTargetKind);
}

function registerActions<const Definitions extends readonly ActionToken[]>(
  policy: CompensationPolicy,
  ...definitions: Definitions
): PolicyRegistration<Definitions> {
  return { policy, definitions };
}

function registerFamily<const Family extends Readonly<Record<string, ActionToken>>>(
  policy: CompensationPolicy,
  family: Family,
): PolicyRegistration<readonly Family[keyof Family][]> {
  return { policy, definitions: Object.values(family) as unknown as readonly Family[keyof Family][] };
}

type RegisteredKind<Registrations extends readonly PolicyRegistration[]> =
  Registrations[number]["definitions"][number]["kind"];
type NonCompensableSystemActionKind = typeof ACTION_DEFINITIONS.node.workspaceBootstrap.kind;
type CompletePolicy<Registrations extends readonly PolicyRegistration[]> =
  Exclude<GraphAction["kind"], RegisteredKind<Registrations> | NonCompensableSystemActionKind> extends never
    ? unknown
    : never;

function compilePolicy<const Registrations extends readonly PolicyRegistration[]>(
  registrations: Registrations & CompletePolicy<Registrations>,
): ReadonlyMap<CompensationTargetKind, CompensationPolicy> {
  const policies = new Map<CompensationTargetKind, CompensationPolicy>();
  for (const registration of registrations) {
    for (const definition of registration.definitions) {
      const kind = definition.kind as CompensationTargetKind;
      if (policies.has(kind)) {
        throw new Error(`History Compensation policy is registered twice for ${kind}`);
      }
      policies.set(kind, registration.policy);
    }
  }
  return policies;
}
