import {
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  graphActionKindsInFamily,
  type AuthoredAction,
  type SequenceAnchor,
} from "../fact/index.js";
import { occurrenceAnchor, type InterpretedProjection } from "../reconcile/index.js";
import type { AuthoredIntentFamily } from "./policy.js";

const TEMPLATE_ACTION_KINDS = graphActionKindsInFamily("template");

export const templateAuthoredIntent = {
  key: "template",
  actionKinds: TEMPLATE_ACTION_KINDS,
  validate(action, context) {
    return validateTemplateDetachment(action, context.projections().available);
  },
} satisfies AuthoredIntentFamily<(typeof TEMPLATE_ACTION_KINDS)[number]>;

function validateTemplateDetachment(
  action: Extract<AuthoredAction, { kind: "template-node-detach" }>,
  available: InterpretedProjection,
): Extract<AuthoredAction, { kind: "template-node-detach" }> {
  const instance = available.templateNodeInstances.find(
    (candidate) =>
      candidate.ownerNodeId === action.ownerNodeId &&
      candidate.templateNodeId === action.templateNodeId &&
      candidate.state === "linked",
  );
  if (!instance) {
    throw new Error("Template Node instance is absent or already detached");
  }
  const expectedAnchor = occurrenceAnchor(available, instance.instanceOccurrenceId);
  if (
    action.instanceNodeId !== templateInstanceNodeId(action.ownerNodeId, action.templateNodeId) ||
    action.instanceOccurrenceId !== templateInstanceOccurrenceId(action.ownerNodeId, action.templateNodeId) ||
    !sameAnchor(action.anchor, expectedAnchor)
  ) {
    throw new Error("Template Node detachment does not match the current instance");
  }
  return action;
}

function sameAnchor(left: SequenceAnchor, right: SequenceAnchor): boolean {
  return (
    left.after === right.after &&
    left.before === right.before &&
    left.affinity === right.affinity &&
    left.fallback === right.fallback
  );
}
