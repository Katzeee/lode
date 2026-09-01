import { graphActionKindsInFamily, type AuthoredAction, type TextAction } from "../fact/index.js";
import { isActiveNode, textAtoms, type InterpretedProjection } from "../reconcile/index.js";
import { AuthoredIntentViolation, type AuthoredIntentContext, type AuthoredIntentFamily } from "./contract.js";

type RichTextSpliceAction = Extract<AuthoredAction, { kind: "rich-text-splice" }>;
type RichTextMarkAction = Extract<AuthoredAction, { kind: "rich-text-mark" }>;

const TEXT_ACTION_KINDS = graphActionKindsInFamily("text");

export const textAuthoredIntent = {
  key: "text",
  actionKinds: TEXT_ACTION_KINDS,
  assert: assertTextAuthoredIntent,
} satisfies AuthoredIntentFamily<(typeof TEXT_ACTION_KINDS)[number]>;

function assertTextAuthoredIntent(action: TextAction, context: AuthoredIntentContext): void {
  const { available } = context;
  switch (action.kind) {
    case "rich-text-splice":
      assertTextSplice(action, available);
      return;
    case "rich-text-mark":
      assertTextMark(action, available);
      return;
    default:
      action satisfies never;
  }
}

function assertTextSplice(action: RichTextSpliceAction, available: InterpretedProjection): void {
  if (!isActiveNode(available.identity.workspaceNodeId, available, action.nodeId)) {
    throw new AuthoredIntentViolation("Text target Node is absent from the observed projection");
  }
  const node = available.nodes[action.nodeId];
  if (!node) {
    throw new AuthoredIntentViolation("Text target Node is absent from the observed projection");
  }
  const atoms = textAtoms(node);
  assertTextAnchor(
    action,
    node.content.map((item) => item.id),
  );
  for (const id of action.deleteAtomIds) {
    if (!atoms.some((atom) => atom.id === id)) {
      throw new AuthoredIntentViolation(`Text Atom is absent from the observed projection: ${id}`);
    }
  }
}

function assertTextMark(action: RichTextMarkAction, available: InterpretedProjection): void {
  if (!isActiveNode(available.identity.workspaceNodeId, available, action.nodeId)) {
    throw new AuthoredIntentViolation("Text mark target Node is absent from the observed projection");
  }
  const availableNode = available.nodes[action.nodeId];
  const availableAtoms = textAtoms(availableNode);
  if (!availableNode || action.atomIds.some((id) => !availableAtoms.some((atom) => atom.id === id))) {
    throw new AuthoredIntentViolation("Text mark targets an Atom outside the observed projection");
  }
}

function assertTextAnchor(action: RichTextSpliceAction, atomIds: readonly string[]): void {
  for (const endpoint of [action.anchor.after, action.anchor.before]) {
    if (endpoint !== null && !atomIds.includes(endpoint)) {
      throw new AuthoredIntentViolation("Text anchor endpoint is absent from the observed projection");
    }
  }
}
