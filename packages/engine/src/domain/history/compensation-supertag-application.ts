import type { FactAction, SupertagAction } from "../fact/index.js";
import { sequenceAnchorAt, type InterpretedProjection } from "../reconcile/index.js";
import { noCompensation, type CompensationStep } from "./compensation-types.js";

export function compensateSupertagApplication(
  target: FactAction &
    Readonly<{ action: Extract<SupertagAction, { kind: "supertag-application-add" | "supertag-membership-remove" }> }>,
  projection: InterpretedProjection,
  counterfactual: InterpretedProjection,
): CompensationStep {
  const authoredAction = target.action;
  const current = applications(projection, authoredAction.hostNodeId, authoredAction.supertagId);
  if (authoredAction.kind === "supertag-application-add") {
    if (!current.some((application) => application.factActionId === target.id) || current.length !== 1) {
      return noCompensation();
    }
    return ready({
      kind: "supertag-membership-remove",
      hostNodeId: authoredAction.hostNodeId,
      supertagId: authoredAction.supertagId,
    });
  }
  const before = applications(counterfactual, authoredAction.hostNodeId, authoredAction.supertagId);
  if (current.length > 0 || before.length === 0) {
    return noCompensation();
  }
  const application = before[0];
  if (application === undefined) {
    return noCompensation();
  }
  const metanodeId = counterfactual.metanodes[authoredAction.hostNodeId];
  const order = metanodeId === undefined ? [] : (counterfactual.childOccurrences[metanodeId] ?? []);
  return ready({
    kind: "supertag-application-add",
    hostNodeId: authoredAction.hostNodeId,
    supertagId: authoredAction.supertagId,
    anchor: sequenceAnchorAt(order, order.indexOf(application.applicationOccurrenceId)),
  });
}

function applications(projection: InterpretedProjection, hostNodeId: string, supertagId: string) {
  return (projection.supertagApplications[hostNodeId] ?? []).filter(
    (application) => application.supertagId === supertagId,
  );
}

function ready(action: SupertagAction): CompensationStep {
  return { kind: "ready", actions: [action] };
}
