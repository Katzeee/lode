import type { FactAction, GraphAction } from "../fact/index.js";
import type { InterpretedProjection } from "../reconcile/index.js";

export type CompensationStep =
  Readonly<{ kind: "ready"; actions: readonly GraphAction[] }> | Readonly<{ kind: "stale"; reason: string }>;

export function noCompensation(): CompensationStep {
  return { kind: "ready", actions: [] };
}

export type CompensationTargetAction = Exclude<GraphAction, { kind: "workspace-bootstrap" }>;

export type CompensationRuleContext = Readonly<{
  targetIds: ReadonlySet<string>;
  activeFacts: readonly FactAction[];
  projection: InterpretedProjection;
  counterfactual: InterpretedProjection;
}>;

export type CompensationEntry<Kind extends CompensationTargetAction["kind"] = CompensationTargetAction["kind"]> = (
  context: CompensationRuleContext,
  target: FactAction<Extract<CompensationTargetAction, { kind: Kind }>>,
) => CompensationStep;

/**
 * One inverse per action kind. Totality is enforced by the mapped type: adding
 * an action without declaring its compensation fails to compile.
 */
export type CompensationCatalog = Readonly<{
  [Kind in CompensationTargetAction["kind"]]: CompensationEntry<Kind>;
}>;

export function ready(actions: readonly GraphAction[]): CompensationStep {
  return actions.length === 0 ? noCompensation() : { kind: "ready", actions };
}
