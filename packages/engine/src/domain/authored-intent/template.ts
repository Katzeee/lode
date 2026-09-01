import {
  templateInstanceNodeId,
  templateInstanceOccurrenceId,
  graphActionKindsInFamily,
  type AuthoredAction,
  type SequenceAnchor,
} from "../fact/index.js";
import { occurrenceAnchor, type InterpretedProjection } from "../reconcile/index.js";
import { AuthoredIntentViolation, type AuthoredIntentFamily } from "./contract.js";

const TEMPLATE_ACTION_KINDS = graphActionKindsInFamily("template");

export const templateAuthoredIntent = {
  key: "template",
  actionKinds: TEMPLATE_ACTION_KINDS,
  assert(action, context) {
    assertTemplateDetachment(action, context.available);
  },
} satisfies AuthoredIntentFamily<(typeof TEMPLATE_ACTION_KINDS)[number]>;

function assertTemplateDetachment(
  action: Extract<AuthoredAction, { kind: "template-node-detach" }>,
  available: InterpretedProjection,
): void {
  const instance = available.templateNodeInstances.find(
    (candidate) =>
      candidate.ownerNodeId === action.ownerNodeId &&
      candidate.templateNodeId === action.templateNodeId &&
      candidate.state === "linked",
  );
  if (!instance) {
    throw new AuthoredIntentViolation("Template Node instance is absent or already detached");
  }
  const expectedAnchor = occurrenceAnchor(available, instance.instanceOccurrenceId);
  if (
    action.instanceNodeId !== templateInstanceNodeId(action.ownerNodeId, action.templateNodeId) ||
    action.instanceOccurrenceId !== templateInstanceOccurrenceId(action.ownerNodeId, action.templateNodeId) ||
    !sameAnchor(action.anchor, expectedAnchor)
  ) {
    throw new AuthoredIntentViolation("Template Node detachment does not match the current instance");
  }
}

function sameAnchor(left: SequenceAnchor, right: SequenceAnchor): boolean {
  return (
    left.after === right.after &&
    left.before === right.before &&
    left.affinity === right.affinity &&
    left.fallback === right.fallback
  );
}
