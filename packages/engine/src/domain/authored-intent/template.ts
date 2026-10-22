import { canonicalJson, graphActionKindsInFamily, type AuthoredAction, type SequenceAnchor } from "../fact/index.js";
import { templateMaterializationIdentity, occurrenceAnchor, type InterpretedProjection } from "../reconcile/index.js";
import { templateSourceGraph } from "./template-source-graph.js";
import { assertTemplateReferenceCopies } from "./template-reference.js";
import { AuthoredIntentViolation, type AuthoredIntentFamily } from "./contract.js";

const TEMPLATE_ACTION_KINDS = graphActionKindsInFamily("template");

export const templateAuthoredIntent = {
  key: "template",
  actionKinds: TEMPLATE_ACTION_KINDS,
  assert(action, context) {
    assertTemplateDetachment(action, context.available);
    assertTemplateReferenceCopies(action, context.available, context.resulting);
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
  const expectedIdentity = templateMaterializationIdentity(action.ownerNodeId, action.templateNodeId, available);
  const expectedCopies = templateSourceGraph(
    action.ownerNodeId,
    action.templateNodeId,
    expectedIdentity,
    available,
  ).nodes.map(({ sourceNodeId, sourcePath, instanceNodeId, instanceOccurrenceId }) => ({
    sourceNodeId,
    sourcePath,
    instanceNodeId,
    instanceOccurrenceId,
  }));
  const expectedAnchor = occurrenceAnchor(available, instance.instanceOccurrenceId);
  if (
    action.instanceNodeId !== expectedIdentity.instanceNodeId ||
    action.instanceOccurrenceId !== expectedIdentity.instanceOccurrenceId ||
    !sameAnchor(action.anchor, expectedAnchor) ||
    canonicalJson(action.sources) !== canonicalJson(instance.sources) ||
    canonicalJson(action.copies) !== canonicalJson(expectedCopies)
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
