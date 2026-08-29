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

export type CompensationRule = (
  context: CompensationRuleContext,
  target: FactAction<CompensationTargetAction>,
) => CompensationStep | null;
