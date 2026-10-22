import { effectiveContributions, effectiveProjectionActivation, finalizedNodeIds } from "./deletion-finalization.js";
import { activeFactActions } from "./projection-active.js";
import { projectionStage } from "./projection-stage.js";

export const activationProjectionStage = projectionStage({
  key: "activation",
  dependencies: [],
  project(context) {
    const derived = activeFactActions(context.snapshot, context.perspective);
    const finalized = finalizedNodeIds(derived.actions);
    const actions = effectiveContributions(derived.actions, finalized);
    return {
      actions,
      evidence: effectiveProjectionActivation(derived.activation, derived.actions, actions),
    };
  },
});
